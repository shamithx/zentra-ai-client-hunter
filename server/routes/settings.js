import { TARGET_COUNTRIES, CONFIG } from '../config.js';
import { db, getPublicSettings, getSetting, logActivity, setSetting } from '../db.js';
import { add } from './registry.js';
import { HttpError } from '../lib/http.js';
import { sendQuota } from '../lib/outreach.js';
import { aiStatus, testAi } from '../ai/llm.js';
import { googleStatus, testGoogle } from '../providers/google.js';
import { metaStatus, testMeta } from '../providers/meta.js';
import { removeSamples, seedSamples } from '../sample.js';
import { remoteAccess } from '../lib/network.js';

const SECRET_KEYS = new Set(['ai.api_key', 'google.api_key', 'meta.access_token']);

function integrations() {
  return { ai: aiStatus(), google: googleStatus(), meta: metaStatus() };
}

add('GET', '/settings', async () => {
  return {
    body: {
      settings: getPublicSettings(),
      integrations: integrations(),
      quota: sendQuota(),
      countries: TARGET_COUNTRIES,
      version: CONFIG.version,
      remote: remoteAccess(),
      sample_leads: db.prepare("SELECT COUNT(*) AS c FROM leads WHERE source = 'sample'").get().c,
    },
  };
});

function requireUrlOrEmpty(value, field) {
  if (!value) return '';
  if (!/^https?:\/\/\S+$/i.test(value)) throw new HttpError(400, `${field} must start with http:// or https://`);
  return value;
}

function boundedInt(value, min, max, field) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min || num > max) {
    throw new HttpError(400, `${field} must be between ${min} and ${max}`);
  }
  return Math.round(num);
}

add('PUT', '/settings', async ({ body }) => {
  const updates = body.updates;
  if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
    throw new HttpError(400, 'updates must be an object');
  }
  const allowed = new Set([
    'brand.name', 'brand.owner', 'brand.portfolio', 'brand.instagram', 'brand.services',
    'brand.include_portfolio_link', 'target.countries', 'outreach.min_seconds', 'outreach.max_per_day',
    'outreach.followup_first_days', 'outreach.followup_second_days', 'ai.provider', 'ai.base_url',
    'ai.model', 'ai.api_key', 'google.api_key', 'google.cx', 'meta.access_token',
    'meta.ig_user_id', 'meta.page_id', 'discovery.hashtags',
  ]);

  let changed = 0;
  for (const [key, rawValue] of Object.entries(updates)) {
    if (!allowed.has(key)) throw new HttpError(400, `Unknown setting: ${key}`);
    const value = rawValue === null || rawValue === undefined ? '' : String(rawValue).trim();

    if (SECRET_KEYS.has(key)) {
      if (!value) continue;
      if (value.length > 600) throw new HttpError(400, `${key} is too long`);
      setSetting(key, value, true);
      changed += 1;
      continue;
    }

    switch (key) {
      case 'brand.name':
        if (!value) throw new HttpError(400, 'Brand name is required');
        if (value.length > 80) throw new HttpError(400, 'Brand name is too long');
        break;
      case 'brand.owner':
        if (value.length > 60) throw new HttpError(400, 'Owner name is too long');
        break;
      case 'brand.portfolio':
      case 'brand.instagram':
        requireUrlOrEmpty(value, key === 'brand.portfolio' ? 'Portfolio URL' : 'Instagram URL');
        break;
      case 'brand.services':
        if (value.length > 300) throw new HttpError(400, 'Services list is too long');
        break;
      case 'brand.include_portfolio_link':
        if (!['true', 'false'].includes(value)) throw new HttpError(400, 'Invalid boolean value');
        break;
      case 'target.countries':
        if (value.length > 400) throw new HttpError(400, 'Countries list is too long');
        break;
      case 'outreach.min_seconds':
        setSetting(key, String(boundedInt(value, 30, 3600, 'Minimum gap')), false);
        changed += 1;
        continue;
      case 'outreach.max_per_day':
        setSetting(key, String(boundedInt(value, 1, 100, 'Daily limit')), false);
        changed += 1;
        continue;
      case 'outreach.followup_first_days':
        setSetting(key, String(boundedInt(value, 1, 30, 'First follow-up delay')), false);
        changed += 1;
        continue;
      case 'outreach.followup_second_days':
        setSetting(key, String(boundedInt(value, 2, 60, 'Second follow-up delay')), false);
        changed += 1;
        continue;
      case 'ai.provider':
        if (!['none', 'openai', 'openrouter', 'groq', 'ollama', 'custom'].includes(value)) {
          throw new HttpError(400, 'Unknown AI provider');
        }
        break;
      case 'ai.base_url':
        requireUrlOrEmpty(value, 'AI base URL');
        break;
      case 'ai.model':
        if (value.length > 120) throw new HttpError(400, 'Model name is too long');
        break;
      case 'google.cx':
        if (value.length > 100) throw new HttpError(400, 'Search engine ID is too long');
        break;
      case 'meta.ig_user_id':
      case 'meta.page_id':
        if (value && !/^\d{5,30}$/.test(value)) throw new HttpError(400, 'Meta IDs must be numeric');
        break;
      case 'discovery.hashtags':
        if (value.length > 400) throw new HttpError(400, 'Hashtag list is too long');
        break;
      default:
        break;
    }
    setSetting(key, value, false);
    changed += 1;
  }

  if (Array.isArray(body.clear_secrets)) {
    for (const key of body.clear_secrets) {
      if (!SECRET_KEYS.has(key)) throw new HttpError(400, `Not a secret setting: ${key}`);
      setSetting(key, '', true);
      changed += 1;
    }
  }

  logActivity('settings_updated', `${changed} setting${changed === 1 ? '' : 's'} updated`);
  return { body: { ok: true, changed, settings: getPublicSettings(), integrations: integrations() } };
});

add('POST', '/settings/test/ai', async () => {
  try {
    await testAi();
    return { body: { ok: true, detail: `Connected to ${getSetting('ai.model') || 'provider'}` } };
  } catch (err) {
    throw new HttpError(502, `AI connection failed: ${err.message.slice(0, 240)}`);
  }
});

add('POST', '/settings/test/google', async () => {
  try {
    await testGoogle();
    return { body: { ok: true, detail: 'Google Programmable Search responded' } };
  } catch (err) {
    throw new HttpError(502, `Google connection failed: ${err.message.slice(0, 240)}`);
  }
});

add('POST', '/settings/test/meta', async () => {
  try {
    const name = await testMeta();
    return { body: { ok: true, detail: `Meta token valid for ${name}` } };
  } catch (err) {
    throw new HttpError(502, `Meta connection failed: ${err.message.slice(0, 240)}`);
  }
});

add('POST', '/settings/demo-data', async () => {
  const result = seedSamples();
  logActivity('demo_seeded', `Sample data loaded (${result.added} leads)`);
  return { body: result };
});

add('DELETE', '/settings/demo-data', async () => {
  const result = removeSamples();
  logActivity('demo_removed', `Sample data removed (${result.removed} leads)`);
  return { body: result };
});

add('GET', '/stats', async () => {
  const statusRows = db.prepare("SELECT status, COUNT(*) AS count FROM leads GROUP BY status").all();
  const status = Object.fromEntries(statusRows.map((row) => [row.status, row.count]));
  const totalLeads = statusRows.reduce((sum, row) => sum + row.count, 0);
  const notRejected = totalLeads - (status.rejected || 0);
  const messageCounts = Object.fromEntries(
    db.prepare("SELECT status, COUNT(*) AS count FROM messages GROUP BY status").all()
      .map((row) => [row.status, row.count]),
  );
  const highQuality = db.prepare("SELECT COUNT(*) AS c FROM leads WHERE priority = 'high' AND status != 'rejected'").get().c;
  const avgScore = db.prepare("SELECT AVG(score) AS avg FROM leads WHERE status != 'rejected'").get().avg || 0;
  const byPriority = Object.fromEntries(
    db.prepare("SELECT priority, COUNT(*) AS count FROM leads WHERE status != 'rejected' GROUP BY priority").all()
      .map((row) => [row.priority, row.count]),
  );
  const byPlatform = db.prepare(
    "SELECT platform, COUNT(*) AS count FROM leads WHERE status != 'rejected' GROUP BY platform ORDER BY count DESC",
  ).all();
  const byCategory = db.prepare(
    "SELECT category, COUNT(*) AS count FROM leads WHERE status != 'rejected' AND category != '' GROUP BY category ORDER BY count DESC LIMIT 6",
  ).all();

  const days = [];
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - 13);
  const trendRows = db.prepare(
    "SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count FROM leads WHERE created_at >= ? GROUP BY day",
  ).all(start.toISOString());
  const trendMap = Object.fromEntries(trendRows.map((row) => [row.day, row.count]));
  for (let i = 0; i < 14; i += 1) {
    const day = new Date(start.getTime() + i * 86400_000).toISOString().slice(0, 10);
    days.push({ day, count: trendMap[day] || 0 });
  }

  const dueCount = db.prepare(
    "SELECT COUNT(*) AS c FROM followups f JOIN leads l ON l.id = f.lead_id WHERE f.status = 'pending' AND f.due_at <= ? AND l.status NOT IN ('responded', 'converted', 'rejected')",
  ).get(new Date().toISOString()).c;

  const activity = db.prepare(`
    SELECT a.*, l.name AS lead_name FROM activity a LEFT JOIN leads l ON l.id = a.lead_id
    ORDER BY a.id DESC LIMIT 12
  `).all();

  const responded = (status.responded || 0) + (status.converted || 0);
  const contacted = (status.contacted || 0) + responded;

  return {
    body: {
      total_leads: totalLeads,
      high_quality: highQuality,
      pending_messages: messageCounts.draft || 0,
      approved_messages: messageCounts.approved || 0,
      contacted,
      responses: responded,
      converted: status.converted || 0,
      rejected: status.rejected || 0,
      messages_sent: messageCounts.sent || 0,
      new_leads: status.new || 0,
      reviewing: status.reviewing || 0,
      followups_due: dueCount,
      avg_score: Math.round(avgScore),
      status,
      by_priority: byPriority,
      by_platform: byPlatform,
      by_category: byCategory,
      trend: days,
      funnel: {
        discovered: notRejected,
        high_quality: highQuality,
        contacted,
        responded,
        converted: status.converted || 0,
      },
      quota: sendQuota(),
      integrations: integrations(),
      brand: {
        name: getSetting('brand.name', 'ZENTRA Creates'),
        owner: getSetting('brand.owner', ''),
      },
      activity,
    },
  };
});

add('GET', '/activity', async ({ url }) => {
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 30));
  const items = db.prepare(`
    SELECT a.*, l.name AS lead_name FROM activity a LEFT JOIN leads l ON l.id = a.lead_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit);
  return { body: { items } };
});
