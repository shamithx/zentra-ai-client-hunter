import { db, logActivity, nowIso, parseLeadRow } from '../db.js';
import { add } from './registry.js';
import { HttpError, csvEscape, sendText } from '../lib/http.js';
import { LEAD_STATUSES, PLATFORMS, PRIORITIES } from '../config.js';
import {
  dedupeKeyFor, handleFromProfile, insertLead, normalizeCandidate, parseCsv,
} from '../lib/leads.js';
import { analyzeLead } from '../ai/analyze.js';
import { analyzeHeuristic } from '../ai/scoring.js';
import { generateMessage } from '../ai/message.js';
import {
  cancelFollowUps, dueFollowUps, markMessageSent, scheduleNextFollowUp, sendQuota,
  spamCheck, syncNextFollowUp,
} from '../lib/outreach.js';
import { lookupBusiness } from '../providers/meta.js';
import {
  emailOrEmpty, enumValue, intOrNull, requiredText, text, urlOrEmpty,
} from '../lib/validate.js';

const SORTS = {
  created_at: 'l.created_at',
  updated_at: 'l.updated_at',
  score: 'l.score',
  name: 'l.name',
  followers: 'l.followers',
  status: 'l.status',
  next_follow_up_at: 'l.next_follow_up_at',
  last_contact_at: 'l.last_contact_at',
  priority: "CASE l.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END",
};

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildFilters(query) {
  const where = ['1=1'];
  const params = [];
  const search = (query.get('q') || '').trim().slice(0, 120);
  if (search) {
    const like = `%${escapeLike(search)}%`;
    where.push(`(l.name LIKE ? ESCAPE '\\' OR l.notes LIKE ? ESCAPE '\\' OR l.context LIKE ? ESCAPE '\\'
      OR l.category LIKE ? ESCAPE '\\' OR l.country LIKE ? ESCAPE '\\' OR l.profile_url LIKE ? ESCAPE '\\')`);
    params.push(like, like, like, like, like, like);
  }
  for (const [param, column] of [
    ['status', 'l.status'], ['priority', 'l.priority'], ['platform', 'l.platform'],
    ['country', 'l.country'], ['category', 'l.category'], ['source', 'l.source'],
  ]) {
    const raw = (query.get(param) || '').trim();
    if (!raw) continue;
    const values = raw.split(',').map((value) => value.trim()).filter(Boolean).slice(0, 10);
    if (!values.length) continue;
    where.push(`${column} IN (${values.map(() => '?').join(',')})`);
    params.push(...values);
  }
  if (query.get('followups') === 'due') {
    where.push("l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= ? AND l.status NOT IN ('responded', 'converted', 'rejected')");
    params.push(nowIso());
  }
  if (query.get('min_score')) {
    const min = Number(query.get('min_score'));
    if (Number.isFinite(min)) {
      where.push('l.score >= ?');
      params.push(min);
    }
  }
  if (query.get('has_draft') === 'true') {
    where.push("EXISTS (SELECT 1 FROM messages m WHERE m.lead_id = l.id AND m.status = 'draft')");
  }
  return { where: where.join(' AND '), params };
}

function listLeads(query, { paginate = true } = {}) {
  const { where, params } = buildFilters(query);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM leads l WHERE ${where}`).get(...params).c;
  const sortKey = query.get('sort') || 'score';
  const sort = SORTS[sortKey] || SORTS.score;
  const dir = query.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.max(1, Math.min(100, Number(query.get('pageSize')) || 25));
  const page = Math.max(1, Number(query.get('page')) || 1);
  const offset = (page - 1) * pageSize;
  const limitSql = paginate ? 'LIMIT ? OFFSET ?' : '';
  const limitParams = paginate ? [pageSize, offset] : [];

  const rows = db.prepare(`
    SELECT l.*,
      (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id) AS message_count,
      (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.status = 'draft') AS draft_count,
      (SELECT status FROM messages m WHERE m.lead_id = l.id ORDER BY m.id DESC LIMIT 1) AS last_message_status
    FROM leads l
    WHERE ${where}
    ORDER BY ${sort} ${dir}, l.id DESC
    ${limitSql}
  `).all(...params, ...limitParams);

  const items = rows.map(parseLeadRow);
  if (!paginate) return { items, total };
  return { items, total, page, pageSize, pages: Math.max(1, Math.ceil(total / pageSize)) };
}

function getLead(id) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ?').get(Number(id));
  if (!row) throw new HttpError(404, 'Lead not found');
  return parseLeadRow(row);
}

function saveAnalysis(id, analysis) {
  db.prepare(`
    UPDATE leads SET category = ?, country = ?, why_fit = ?, service_offer = ?, priority = ?,
      score = ?, signals = ?, analysis_mode = ?, analyzed_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    analysis.category || '', analysis.country || '', analysis.why_fit || '', analysis.service_offer || '',
    analysis.priority || 'medium', analysis.score || 0, JSON.stringify(analysis.signals || []),
    analysis.analysis_mode || 'heuristic', nowIso(), nowIso(), id,
  );
}

add('GET', '/leads/export.csv', async ({ res, url }) => {
  const { items } = listLeads(url.searchParams, { paginate: false });
  const columns = [
    ['id', 'id'], ['name', 'Business / Person'], ['platform', 'Platform'],
    ['profile_url', 'Profile URL'], ['post_url', 'Post URL'], ['country', 'Country'],
    ['category', 'Category'], ['followers', 'Followers'], ['website', 'Website'], ['email', 'Email'],
    ['priority', 'Priority'], ['score', 'Score'], ['status', 'Status'], ['service_offer', 'Service to offer'],
    ['why_fit', 'Why they fit'], ['source', 'Source'], ['created_at', 'Discovered at'],
    ['last_contact_at', 'Last contacted'], ['next_follow_up_at', 'Next follow-up'], ['notes', 'Notes'],
  ];
  const lines = [columns.map(([, label]) => csvEscape(label)).join(',')];
  for (const lead of items) {
    lines.push(columns.map(([key]) => csvEscape(lead[key])).join(','));
  }
  const body = '\uFEFF' + lines.join('\r\n');
  const filename = `zentra-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  sendText(res, 200, body, 'text/csv; charset=utf-8', {
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
});

add('GET', '/leads', async ({ url }) => {
  const result = listLeads(url.searchParams);
  const countries = db.prepare(
    "SELECT country AS value, COUNT(*) AS count FROM leads WHERE country != '' GROUP BY country ORDER BY count DESC LIMIT 40",
  ).all();
  const categories = db.prepare(
    "SELECT category AS value, COUNT(*) AS count FROM leads WHERE category != '' GROUP BY category ORDER BY count DESC LIMIT 40",
  ).all();
  return { body: { ...result, facets: { countries, categories }, quota: sendQuota() } };
});

add('POST', '/leads', async ({ body }) => {
  const raw = {
    name: requiredText(body.name, 120, 'Name'),
    platform: enumValue(body.platform || 'instagram', PLATFORMS, 'Platform'),
    profile_url: urlOrEmpty(body.profile_url, 'Profile URL'),
    post_url: urlOrEmpty(body.post_url, 'Post URL'),
    country: text(body.country, 80, 'Country'),
    category: text(body.category, 80, 'Category'),
    followers: intOrNull(body.followers, { field: 'Followers' }),
    website: urlOrEmpty(body.website, 'Website'),
    email: emailOrEmpty(body.email),
    context: text(body.context, 4000, 'Context'),
    notes: text(body.notes, 4000, 'Notes'),
    source: 'manual',
  };
  const result = insertLead(raw, { allowCompetitor: true });
  return {
    status: result.added ? 201 : 200,
    body: { ...result, lead: parseLeadRow(result.lead) },
  };
});

add('GET', '/leads/:id', async ({ params }) => {
  const lead = getLead(params.id);
  const messages = db.prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY id DESC').all(lead.id);
  const followups = db.prepare('SELECT * FROM followups WHERE lead_id = ? ORDER BY due_at ASC').all(lead.id);
  const activity = db.prepare(
    'SELECT * FROM activity WHERE lead_id = ? ORDER BY id DESC LIMIT 30',
  ).all(lead.id);
  return { body: { lead, messages, followups, activity, quota: sendQuota() } };
});

add('PATCH', '/leads/:id', async ({ params, body }) => {
  const lead = getLead(params.id);
  const updates = {};

  if (body.name !== undefined) updates.name = requiredText(body.name, 120, 'Name');
  if (body.platform !== undefined) updates.platform = enumValue(body.platform, PLATFORMS, 'Platform');
  if (body.profile_url !== undefined) updates.profile_url = urlOrEmpty(body.profile_url, 'Profile URL');
  if (body.post_url !== undefined) updates.post_url = urlOrEmpty(body.post_url, 'Post URL');
  if (body.country !== undefined) updates.country = text(body.country, 80, 'Country');
  if (body.category !== undefined) updates.category = text(body.category, 80, 'Category');
  if (body.followers !== undefined) updates.followers = intOrNull(body.followers, { field: 'Followers' });
  if (body.website !== undefined) updates.website = urlOrEmpty(body.website, 'Website');
  if (body.email !== undefined) updates.email = emailOrEmpty(body.email);
  if (body.context !== undefined) updates.context = text(body.context, 4000, 'Context');
  if (body.notes !== undefined) updates.notes = text(body.notes, 4000, 'Notes');
  if (body.service_offer !== undefined) updates.service_offer = text(body.service_offer, 400, 'Service offer');
  if (body.why_fit !== undefined) updates.why_fit = text(body.why_fit, 1200, 'Why fit');
  if (body.priority !== undefined) updates.priority = enumValue(body.priority, PRIORITIES, 'Priority');
  if (body.status !== undefined) updates.status = enumValue(body.status, LEAD_STATUSES, 'Status');
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) throw new HttpError(400, 'Tags must be an array');
    updates.tags = JSON.stringify(body.tags.slice(0, 12).map((tag) => text(tag, 40, 'Tag')));
  }

  if (!Object.keys(updates).length) throw new HttpError(400, 'No changes supplied');

  if (updates.status) {
    const previous = lead.status;
    if (previous !== updates.status) {
      logActivity('status_changed', `Status changed from ${previous} to ${updates.status}`, lead.id);
    }
    if (['responded', 'converted', 'rejected', 'new', 'reviewing'].includes(updates.status)) {
      cancelFollowUps(lead.id);
    }
  }

  const changedIdentity = ['name', 'platform', 'profile_url', 'post_url'].some((field) => field in updates);
  if (changedIdentity) {
    const merged = normalizeCandidate({ ...lead, ...updates });
    const key = dedupeKeyFor(merged);
    const clash = db.prepare('SELECT id FROM leads WHERE dedupe_key = ? AND id != ?').get(key, lead.id);
    if (clash) throw new HttpError(409, 'Another lead already uses that profile or page');
    updates.dedupe_key = key;
  }

  updates.updated_at = nowIso();
  const assignments = Object.keys(updates).map((key) => `${key} = ?`).join(', ');
  db.prepare(`UPDATE leads SET ${assignments} WHERE id = ?`)
    .run(...Object.values(updates), lead.id);

  return { body: { lead: getLead(lead.id) } };
});

add('DELETE', '/leads/:id', async ({ params }) => {
  const lead = getLead(params.id);
  db.prepare('DELETE FROM leads WHERE id = ?').run(lead.id);
  logActivity('lead_deleted', `Deleted ${lead.name}`, null);
  return { body: { ok: true } };
});

add('POST', '/leads/:id/analyze', async ({ params }) => {
  const lead = getLead(params.id);
  const { analysis, warning } = await analyzeLead(lead);
  saveAnalysis(lead.id, analysis);
  logActivity('lead_analyzed', `${analysis.analysis_mode === 'ai' ? 'AI' : 'Heuristic'} analysis scored ${analysis.score}/100`, lead.id);
  return { body: { lead: getLead(lead.id), weak_input: !lead.context && !lead.notes, warning } };
});

add('POST', '/leads/:id/enrich', async ({ params, body }) => {
  const lead = getLead(params.id);
  const username = text(body.username, 60) || handleFromProfile(lead.profile_url);
  if (!username) throw new HttpError(400, 'No Instagram username available for this lead');
  const profile = await lookupBusiness(username);
  const context = [lead.context, profile.biography || ''].filter(Boolean).join(' ').slice(0, 4000);
  db.prepare(`
    UPDATE leads SET followers = ?, website = ?, context = ?, name = ?, updated_at = ? WHERE id = ?
  `).run(
    profile.followers_count ?? lead.followers,
    lead.website || profile.website || '',
    context,
    lead.name || profile.name || profile.username,
    nowIso(),
    lead.id,
  );
  const refreshed = getLead(lead.id);
  const heuristic = analyzeHeuristic(refreshed);
  db.prepare(`
    UPDATE leads SET priority = ?, score = ?, signals = ?, why_fit = ?, service_offer = ?,
      category = ?, analysis_mode = 'heuristic', analyzed_at = ?, updated_at = ? WHERE id = ?
  `).run(
    heuristic.priority, heuristic.score, JSON.stringify(heuristic.signals), heuristic.why_fit,
    heuristic.service_offer, heuristic.category, nowIso(), nowIso(), lead.id,
  );
  logActivity('lead_enriched', `Enriched ${lead.name} from Instagram`, lead.id);
  return { body: { lead: getLead(lead.id) } };
});

add('POST', '/leads/:id/messages', async ({ params, body }) => {
  const lead = getLead(params.id);
  const initialSent = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE lead_id = ? AND kind = 'initial' AND status = 'sent'",
  ).get(lead.id).c;
  const followUpsSent = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE lead_id = ? AND kind = 'followup' AND status = 'sent'",
  ).get(lead.id).c;

  let kind = body.kind === 'followup' ? 'followup' : 'initial';
  if (kind === 'initial' && initialSent > 0) {
    throw new HttpError(409, 'The first message was already sent. Generate a follow-up instead.');
  }
  if (kind === 'followup' && initialSent === 0) {
    throw new HttpError(409, 'Send the first message before creating a follow-up.');
  }
  if (followUpsSent >= 2) throw new HttpError(409, 'Two follow-ups have already been sent. Leave this lead alone.');

  const tone = ['friendly', 'direct', 'professional'].includes(body.tone) ? body.tone : 'friendly';
  const step = kind === 'followup' ? followUpsSent + 1 : 1;
  const observation = text(body.observation, 200, 'Observation');

  const existingDraft = db.prepare(
    "SELECT * FROM messages WHERE lead_id = ? AND kind = ? AND status = 'draft' ORDER BY id DESC LIMIT 1",
  ).get(lead.id, kind);

  const generated = await generateMessage(lead, { tone, observation, kind, step });
  const check = spamCheck(generated.body, {
    leadId: lead.id,
    excludeMessageId: existingDraft?.id || null,
    kind,
  });

  const ts = nowIso();
  let messageId;
  if (existingDraft) {
    db.prepare(`
      UPDATE messages SET body = ?, tone = ?, created_by = ?, edited = 1, updated_at = ? WHERE id = ?
    `).run(generated.body, tone, generated.mode, ts, existingDraft.id);
    messageId = existingDraft.id;
  } else {
    const result = db.prepare(`
      INSERT INTO messages (lead_id, kind, body, status, channel, tone, created_by, created_at, updated_at)
      VALUES (?, ?, ?, 'draft', 'manual', ?, ?, ?, ?)
    `).run(lead.id, kind, generated.body, tone, generated.mode, ts, ts);
    messageId = result.lastInsertRowid;
  }

  if (lead.status === 'new') {
    db.prepare("UPDATE leads SET status = 'reviewing', updated_at = ? WHERE id = ?").run(ts, lead.id);
  }
  logActivity('message_drafted', `${kind === 'followup' ? 'Follow-up' : 'First message'} draft created`, lead.id);

  return {
    body: {
      message: db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId),
      warnings: check.warnings,
      mode: generated.mode,
      warning: generated.warning,
    },
  };
});

add('POST', '/leads/import', async ({ body }) => {
  const csv = text(body.csv, 4_000_000, 'CSV');
  if (!csv) throw new HttpError(400, 'Paste CSV content first');
  const { candidates } = parseCsv(csv);
  if (!candidates.length) throw new HttpError(400, 'No rows with a name or URL were found');
  if (candidates.length > 500) throw new HttpError(400, 'Import is limited to 500 rows at a time');

  const summary = { added: 0, duplicates: 0, competitors: 0, total: candidates.length, added_leads: [] };
  for (const candidate of candidates) {
    const result = insertLead({ ...candidate, source: 'csv_import' }, { allowCompetitor: false });
    if (result.added) {
      summary.added += 1;
      if (summary.added_leads.length < 10) summary.added_leads.push(result.lead.name);
    } else if (result.reason === 'competitor') {
      summary.competitors += 1;
    } else {
      summary.duplicates += 1;
    }
  }
  logActivity('import_completed', `CSV import: ${summary.added} added, ${summary.duplicates} duplicates, ${summary.competitors} filtered`);
  return { body: summary };
});

add('GET', '/messages', async ({ url }) => {
  const where = ['1=1'];
  const params = [];
  const status = url.searchParams.get('status');
  if (status) {
    const values = status.split(',').filter((value) => ['draft', 'approved', 'sent', 'rejected'].includes(value));
    if (values.length) {
      where.push(`m.status IN (${values.map(() => '?').join(',')})`);
      params.push(...values);
    }
  }
  const kind = url.searchParams.get('kind');
  if (['initial', 'followup'].includes(kind)) {
    where.push('m.kind = ?');
    params.push(kind);
  }
  const leadId = Number(url.searchParams.get('lead_id'));
  if (leadId) {
    where.push('m.lead_id = ?');
    params.push(leadId);
  }
  const includeChecks = url.searchParams.get('include_checks') === '1';
  const rows = db.prepare(`
    SELECT m.*, l.name AS lead_name, l.platform, l.profile_url, l.priority, l.category,
           l.status AS lead_status, l.country
    FROM messages m JOIN leads l ON l.id = m.lead_id
    WHERE ${where.join(' AND ')}
    ORDER BY CASE m.status WHEN 'draft' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, m.id DESC
    LIMIT 200
  `).all(...params);

  const items = rows.map((row) => ({
    ...row,
    warnings: includeChecks && row.status !== 'sent'
      ? spamCheck(row.body, { leadId: row.lead_id, excludeMessageId: row.id, kind: row.kind }).warnings
      : [],
  }));
  return { body: { items, quota: sendQuota() } };
});

add('POST', '/messages/check', async ({ body }) => {
  const leadId = Number(body.lead_id);
  if (!leadId) throw new HttpError(400, 'lead_id is required');
  const result = spamCheck(text(body.body, 2000, 'Message'), {
    leadId,
    excludeMessageId: body.message_id ? Number(body.message_id) : null,
    kind: body.kind === 'followup' ? 'followup' : 'initial',
  });
  return { body: result };
});

add('PATCH', '/messages/:id', async ({ params, body }) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(params.id));
  if (!message) throw new HttpError(404, 'Message not found');
  if (message.status === 'sent') throw new HttpError(409, 'Sent messages cannot be edited');
  if (message.status === 'rejected') throw new HttpError(409, 'Rejected messages cannot be edited');
  const newBody = text(body.body, 2000, 'Message');
  if (newBody.length < 20) throw new HttpError(400, 'Message is too short');
  const wasApproved = message.status === 'approved';
  db.prepare(`
    UPDATE messages SET body = ?, edited = 1, status = 'draft', approved_at = NULL, updated_at = ? WHERE id = ?
  `).run(newBody, nowIso(), message.id);
  if (wasApproved) {
    logActivity('approval_reset', 'Edited message needs approval again', message.lead_id);
  }
  const check = spamCheck(newBody, { leadId: message.lead_id, excludeMessageId: message.id, kind: message.kind });
  return {
    body: {
      message: db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id),
      warnings: check.warnings,
      approval_reset: wasApproved,
    },
  };
});

add('POST', '/messages/:id/approve', async ({ params }) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(params.id));
  if (!message) throw new HttpError(404, 'Message not found');
  if (!['draft', 'approved'].includes(message.status)) throw new HttpError(409, 'Only drafts can be approved');
  const check = spamCheck(message.body, { leadId: message.lead_id, excludeMessageId: message.id, kind: message.kind });
  const errors = check.warnings.filter((warning) => warning.level === 'error');
  if (errors.length) {
    throw new HttpError(422, 'Fix the blocking issues before approving this message', { warnings: check.warnings });
  }
  const ts = nowIso();
  db.prepare("UPDATE messages SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ?")
    .run(ts, ts, message.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(message.lead_id);
  if (['new', 'reviewing'].includes(lead.status)) {
    db.prepare("UPDATE leads SET status = 'approved', updated_at = ? WHERE id = ?").run(ts, lead.id);
  }
  logActivity('message_approved', `Message approved for ${lead.name}`, lead.id);
  return {
    body: {
      message: db.prepare('SELECT * FROM messages WHERE id = ?').get(message.id),
      warnings: check.warnings,
      quota: sendQuota(),
    },
  };
});

add('POST', '/messages/:id/reject', async ({ params, body }) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(params.id));
  if (!message) throw new HttpError(404, 'Message not found');
  if (message.status === 'sent') throw new HttpError(409, 'Sent messages cannot be rejected');
  const reason = text(body.reason, 300, 'Reason');
  db.prepare("UPDATE messages SET status = 'rejected', error = ?, updated_at = ? WHERE id = ?")
    .run(reason || 'Rejected by user', nowIso(), message.id);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(message.lead_id);
  const stillActive = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE lead_id = ? AND status IN ('approved', 'sent')",
  ).get(lead.id).c;
  if (lead.status === 'approved' && !stillActive) {
    db.prepare("UPDATE leads SET status = 'reviewing', updated_at = ? WHERE id = ?").run(nowIso(), lead.id);
  }
  logActivity('message_rejected', `Message rejected for ${lead.name}${reason ? `: ${reason}` : ''}`, lead.id);
  return { body: { ok: true } };
});

add('POST', '/messages/:id/send', async ({ params }) => {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(params.id));
  if (!message) throw new HttpError(404, 'Message not found');
  if (message.status !== 'approved') throw new HttpError(403, 'Approve this message before marking it sent');
  const check = spamCheck(message.body, { leadId: message.lead_id, excludeMessageId: message.id, kind: message.kind });
  const errors = check.warnings.filter((warning) => warning.level === 'error');
  if (errors.length) {
    throw new HttpError(422, 'This message no longer passes the anti-spam checks. Edit and re-approve it.', { warnings: check.warnings });
  }
  const result = markMessageSent(message.id);
  return { body: { ...result, quota: sendQuota() } };
});

add('GET', '/followups', async () => {
  const all = db.prepare(`
    SELECT f.*, l.name AS lead_name, l.platform, l.profile_url, l.priority, l.category,
           l.status AS lead_status, l.last_contact_at,
           (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.kind = 'followup' AND m.status = 'sent') AS followups_sent
    FROM followups f JOIN leads l ON l.id = f.lead_id
    ORDER BY CASE f.status WHEN 'pending' THEN 0 ELSE 1 END, f.due_at ASC
    LIMIT 200
  `).all();
  const now = nowIso();
  const pending = all.filter((row) => row.status === 'pending');
  return {
    body: {
      due: pending.filter((row) => row.due_at <= now),
      upcoming: pending.filter((row) => row.due_at > now),
      history: all.filter((row) => row.status !== 'pending').slice(0, 20),
    },
  };
});

add('POST', '/followups/:id/generate', async ({ params, body }) => {
  const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(Number(params.id));
  if (!followup) throw new HttpError(404, 'Follow-up not found');
  if (followup.status !== 'pending') throw new HttpError(409, 'This follow-up is already closed');
  const lead = getLead(followup.lead_id);
  const sent = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE lead_id = ? AND kind = 'followup' AND status = 'sent'",
  ).get(lead.id).c;
  if (sent >= 2) throw new HttpError(409, 'Two follow-ups have already been sent');

  const step = sent + 1;
  const tone = ['friendly', 'direct', 'professional'].includes(body.tone) ? body.tone : 'friendly';
  const generated = await generateMessage(lead, {
    tone,
    kind: 'followup',
    step,
    observation: text(body.observation, 200, 'Observation'),
  });
  const existingDraft = db.prepare(
    "SELECT * FROM messages WHERE lead_id = ? AND kind = 'followup' AND status = 'draft' ORDER BY id DESC LIMIT 1",
  ).get(lead.id);
  const check = spamCheck(generated.body, {
    leadId: lead.id,
    excludeMessageId: existingDraft?.id || null,
    kind: 'followup',
  });

  const ts = nowIso();
  let messageId;
  if (existingDraft) {
    db.prepare(`
      UPDATE messages SET body = ?, tone = ?, created_by = ?, edited = 1, updated_at = ? WHERE id = ?
    `).run(generated.body, tone, generated.mode, ts, existingDraft.id);
    messageId = existingDraft.id;
  } else {
    messageId = db.prepare(`
      INSERT INTO messages (lead_id, kind, body, status, channel, tone, created_by, created_at, updated_at)
      VALUES (?, 'followup', ?, 'draft', 'manual', ?, ?, ?, ?)
    `).run(lead.id, generated.body, tone, generated.mode, ts, ts).lastInsertRowid;
  }
  db.prepare('UPDATE followups SET message_id = ? WHERE id = ?').run(messageId, followup.id);
  logActivity('followup_drafted', `Follow-up draft created for ${lead.name}`, lead.id);

  return {
    body: {
      message: db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId),
      warnings: check.warnings,
      mode: generated.mode,
      warning: generated.warning,
    },
  };
});

add('POST', '/followups/:id/skip', async ({ params }) => {
  const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(Number(params.id));
  if (!followup) throw new HttpError(404, 'Follow-up not found');
  db.prepare("UPDATE followups SET status = 'skipped' WHERE id = ?").run(followup.id);
  syncNextFollowUp(followup.lead_id);
  logActivity('followup_skipped', 'Follow-up skipped', followup.lead_id);
  return { body: { ok: true, next_follow_up_at: syncNextFollowUp(followup.lead_id) } };
});

add('POST', '/followups/:id/done', async ({ params }) => {
  const followup = db.prepare('SELECT * FROM followups WHERE id = ?').get(Number(params.id));
  if (!followup) throw new HttpError(404, 'Follow-up not found');
  db.prepare("UPDATE followups SET status = 'done' WHERE id = ?").run(followup.id);
  scheduleNextFollowUp(followup.lead_id);
  logActivity('followup_done', 'Follow-up completed outside the app', followup.lead_id);
  return { body: { ok: true, next_follow_up_at: syncNextFollowUp(followup.lead_id) } };
});

add('GET', '/followups/due', async () => ({ body: { items: dueFollowUps() } }));

export { listLeads, getLead, buildFilters };
