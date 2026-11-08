import { db, getSetting, logActivity, nowIso, parseLeadRow } from '../db.js';
import { add } from './registry.js';
import { HttpError } from '../lib/http.js';
import { insertLead, parseBulkText } from '../lib/leads.js';
import { GOOGLE_PRESETS, googleSearch, googleStatus } from '../providers/google.js';
import { hashtagSearch, lookupBusiness, metaStatus } from '../providers/meta.js';
import { boolean, text } from '../lib/validate.js';

function startRun(provider, query) {
  const id = db.prepare(
    "INSERT INTO discovery_runs (provider, query, status, created_at) VALUES (?, ?, 'running', ?)",
  ).run(provider, query, nowIso()).lastInsertRowid;
  return Number(id);
}

function finishRun(id, { added, skipped, found, error }) {
  db.prepare(`
    UPDATE discovery_runs SET status = ?, found = ?, added = ?, skipped = ?, error = ?, finished_at = ?
    WHERE id = ?
  `).run(error ? 'error' : 'done', found || 0, added || 0, skipped || 0, error || null, nowIso(), id);
}

function saveCandidates(candidates, payload = {}) {
  const summary = {
    found: candidates.length,
    added: 0,
    duplicates: 0,
    competitors: 0,
    leads: [],
    skipped_examples: [],
  };
  for (const candidate of candidates) {
    const result = insertLead({ ...candidate, ...payload }, { allowCompetitor: false });
    if (result.added) {
      summary.added += 1;
      if (summary.leads.length < 12) summary.leads.push(parseLeadRow(result.lead));
    } else if (result.reason === 'competitor') {
      summary.competitors += 1;
      if (summary.skipped_examples.length < 5) summary.skipped_examples.push(candidate.name || candidate.profile_url);
    } else {
      summary.duplicates += 1;
    }
  }
  return summary;
}

function hashtags() {
  return getSetting('discovery.hashtags', '')
    .split(',')
    .map((tag) => tag.trim().replace(/^#/, ''))
    .filter(Boolean)
    .slice(0, 20);
}

add('GET', '/discovery/presets', async () => {
  const tags = hashtags();
  const guided = [
    ...tags.slice(0, 6).map((tag) => ({
      label: `#${tag} on Instagram`,
      platform: 'instagram',
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`,
      note: 'Open the hashtag, check recent posts, then paste profile or post URLs into Bulk import.',
    })),
    {
      label: 'Facebook posts: video editor wanted',
      platform: 'facebook',
      url: 'https://www.facebook.com/search/posts/?q=need%20a%20video%20editor',
      note: 'Facebook public post search. Verify the page before adding.',
    },
    {
      label: 'Facebook pages: video editor wanted',
      platform: 'facebook',
      url: 'https://www.facebook.com/search/pages/?q=video%20editor%20needed',
      note: 'Page search surfaces businesses asking for editing help.',
    },
    ...GOOGLE_PRESETS.slice(0, 4).map((preset) => ({
      label: preset.label,
      platform: 'google',
      url: `https://www.google.com/search?q=${encodeURIComponent(preset.query)}`,
      note: 'Public web search. Copy promising profile links.',
    })),
  ];

  return {
    body: {
      guided,
      google_presets: GOOGLE_PRESETS,
      hashtags: tags,
      integrations: { google: googleStatus(), meta: metaStatus() },
    },
  };
});

add('POST', '/discovery/google', async ({ body }) => {
  const query = text(body.query, 300, 'Query');
  if (!query) throw new HttpError(400, 'Enter a search query');
  const limit = Math.max(1, Math.min(10, Number(body.limit) || 10));
  const runId = startRun('google_cse', query);
  try {
    const { candidates, total_results } = await googleSearch(query, limit);
    const summary = saveCandidates(candidates, { source: 'google_cse', source_query: query });
    finishRun(runId, { found: summary.found, added: summary.added, skipped: summary.duplicates + summary.competitors });
    logActivity('discovery_run', `Google search “${query.slice(0, 80)}”: ${summary.added} new leads`);
    return {
      body: {
        run_id: runId,
        provider: 'google_cse',
        query,
        total_results,
        ...summary,
      },
    };
  } catch (err) {
    finishRun(runId, { error: err.message.slice(0, 300) });
    throw err;
  }
});

add('POST', '/discovery/meta-hashtag', async ({ body }) => {
  const tag = text(body.tag, 60, 'Hashtag').replace(/^#/, '');
  if (!tag) throw new HttpError(400, 'Enter a hashtag');
  const limit = Math.max(5, Math.min(50, Number(body.limit) || 25));
  const enrich = body.enrich === undefined ? true : boolean(body.enrich);
  const runId = startRun('meta_hashtag', `#${tag}`);
  try {
    const { candidates, note } = await hashtagSearch(tag, { limit, enrich });
    const summary = saveCandidates(candidates, { source: 'meta_hashtag' });
    finishRun(runId, { found: summary.found, added: summary.added, skipped: summary.duplicates + summary.competitors });
    logActivity('discovery_run', `Instagram #${tag}: ${summary.added} new leads`);
    return { body: { run_id: runId, provider: 'meta_hashtag', query: `#${tag}`, note, ...summary } };
  } catch (err) {
    finishRun(runId, { error: err.message.slice(0, 300) });
    throw err;
  }
});

add('POST', '/discovery/bulk', async ({ body }) => {
  const raw = text(body.text, 200_000, 'Pasted URLs');
  const parsed = parseBulkText(raw);
  if (!parsed.length) throw new HttpError(400, 'No http(s) URLs found. Paste one profile or post URL per line.');
  if (parsed.length > 200) throw new HttpError(400, 'Bulk import is limited to 200 URLs at a time');
  const summary = saveCandidates(parsed, { source: 'manual_paste' });
  logActivity('discovery_run', `Bulk paste: ${summary.added} new leads from ${parsed.length} URLs`);
  return { body: { provider: 'manual_paste', ...summary } };
});

add('POST', '/discovery/lookup', async ({ body }) => {
  const username = text(body.username, 60, 'Username').replace(/^@/, '');
  if (!username) throw new HttpError(400, 'Enter an Instagram username');
  const profile = await lookupBusiness(username);
  return {
    body: {
      profile: {
        name: profile.name,
        username: profile.username,
        followers: profile.followers_count,
        media_count: profile.media_count,
        biography: profile.biography,
        website: profile.website,
      },
    },
  };
});

add('GET', '/discovery/runs', async () => {
  const runs = db.prepare('SELECT * FROM discovery_runs ORDER BY id DESC LIMIT 15').all();
  return { body: { runs } };
});
