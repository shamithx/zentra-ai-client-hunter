import { db, getSetting, logActivity, nowIso } from '../db.js';
import { HttpError } from './http.js';

export function outreachLimits() {
  return {
    minSeconds: Math.max(30, Number(getSetting('outreach.min_seconds', '90')) || 90),
    maxPerDay: Math.max(1, Math.min(100, Number(getSetting('outreach.max_per_day', '20')) || 20)),
    firstDays: Math.max(1, Number(getSetting('outreach.followup_first_days', '3')) || 3),
    secondDays: Math.max(2, Number(getSetting('outreach.followup_second_days', '7')) || 7),
  };
}

export function sendQuota() {
  const limits = outreachLimits();
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const used = db.prepare('SELECT COUNT(*) AS c FROM messages WHERE sent_at >= ?').get(start.toISOString()).c;
  const last = db.prepare('SELECT MAX(sent_at) AS last FROM messages WHERE sent_at IS NOT NULL').get().last;
  const nextAllowed = last ? new Date(new Date(last).getTime() + limits.minSeconds * 1000) : null;
  const waitMs = nextAllowed ? nextAllowed.getTime() - Date.now() : 0;
  return {
    used,
    max: limits.maxPerDay,
    remaining: Math.max(0, limits.maxPerDay - used),
    minSeconds: limits.minSeconds,
    nextAllowedAt: waitMs > 0 ? nextAllowed.toISOString() : null,
    canSendNow: used < limits.maxPerDay && waitMs <= 0,
  };
}

export function assertSendAllowed() {
  const quota = sendQuota();
  if (quota.used >= quota.max) {
    throw new HttpError(429, `Daily outreach limit reached (${quota.max} messages). This is a safety limit, not a target.`);
  }
  if (quota.nextAllowedAt) {
    const seconds = Math.ceil((new Date(quota.nextAllowedAt).getTime() - Date.now()) / 1000);
    throw new HttpError(429, `Please wait ${seconds}s before marking another message as sent.`);
  }
  return quota;
}

const normalizeBody = (text) => String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();

export function findDuplicate(body, leadId, excludeMessageId = null) {
  const normalized = normalizeBody(body);
  if (normalized.length < 40) return null;
  const rows = db.prepare(`
    SELECT m.id, m.body, m.kind, m.status, l.id AS lead_id, l.name AS lead_name
    FROM messages m JOIN leads l ON l.id = m.lead_id
    WHERE m.lead_id != ? AND m.status IN ('draft', 'approved', 'sent')
    ORDER BY m.id DESC LIMIT 500
  `).all(leadId);
  for (const row of rows) {
    if (excludeMessageId && row.id === Number(excludeMessageId)) continue;
    if (normalizeBody(row.body) === normalized) {
      return { message_id: row.id, lead_id: row.lead_id, lead_name: row.lead_name, kind: row.kind };
    }
  }
  return null;
}

const BANNED = [
  'guaranteed', '100% free', 'click here', 'buy now', 'limited time offer',
  'dear sir', 'dear madam', 'i hope this message finds you well', 'i am reaching out',
  'make money fast', 'risk free', 'act now',
];

export function spamCheck(body, { leadId, excludeMessageId = null, kind = 'initial' } = {}) {
  const text = String(body || '');
  const warnings = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();

  if (text.trim().length < 40) warnings.push({ level: 'error', text: 'Message is too short to feel personal.' });
  if (words.length > 160) warnings.push({ level: 'warn', text: 'Long messages get fewer replies — aim for under 120 words.' });

  const links = text.match(/https?:\/\/\S+/gi) || [];
  if (links.length > 1) warnings.push({ level: 'error', text: 'More than one link looks promotional and can get filtered.' });
  if (links.length === 1) warnings.push({ level: 'warn', text: 'Links in a first DM can reduce deliverability. Consider offering examples instead.' });

  const letters = text.replace(/[^a-zA-Z]/g, '');
  const caps = text.replace(/[^A-Z]/g, '');
  if (letters.length > 20 && caps.length / letters.length > 0.35) {
    warnings.push({ level: 'error', text: 'Too many capital letters — reads like spam.' });
  }

  const emojis = text.match(/\p{Extended_Pictographic}/gu) || [];
  if (emojis.length > 2) warnings.push({ level: 'warn', text: 'Too many emojis for a first message.' });
  if (text.includes('#')) warnings.push({ level: 'warn', text: 'Hashtags in DMs look like broadcast spam.' });

  for (const phrase of BANNED) {
    if (lower.includes(phrase)) {
      warnings.push({ level: 'error', text: `Contains a spam trigger phrase: “${phrase}”.` });
    }
  }

  if (!text.includes('?')) {
    warnings.push({ level: 'warn', text: 'No question — a single clear question lifts reply rates.' });
  }

  const duplicate = findDuplicate(text, leadId, excludeMessageId);
  if (duplicate) {
    warnings.push({
      level: kind === 'initial' ? 'error' : 'warn',
      text: `Identical text was already used for “${duplicate.lead_name}”. Personalise before sending.`,
    });
  }

  return { warnings, duplicate, words: words.length, links: links.length };
}

export function scheduleInitialFollowUp(leadId) {
  const { firstDays } = outreachLimits();
  const existing = db.prepare(`
    SELECT id FROM followups WHERE lead_id = ? AND status IN ('pending', 'done')
  `).get(leadId);
  if (existing) return null;
  const due = new Date(Date.now() + firstDays * 86400_000).toISOString();
  db.prepare('INSERT INTO followups (lead_id, due_at, status, created_at) VALUES (?, ?, ?, ?)')
    .run(leadId, due, 'pending', nowIso());
  syncNextFollowUp(leadId);
  return due;
}

export function scheduleNextFollowUp(leadId) {
  const { secondDays } = outreachLimits();
  const sentFollowUps = db.prepare(
    "SELECT COUNT(*) AS c FROM messages WHERE lead_id = ? AND kind = 'followup' AND status = 'sent'",
  ).get(leadId).c;
  if (sentFollowUps >= 2) {
    syncNextFollowUp(leadId);
    return null;
  }
  const due = new Date(Date.now() + secondDays * 86400_000).toISOString();
  db.prepare('INSERT INTO followups (lead_id, due_at, status, created_at) VALUES (?, ?, ?, ?)')
    .run(leadId, due, 'pending', nowIso());
  syncNextFollowUp(leadId);
  return due;
}

export function syncNextFollowUp(leadId) {
  const next = db.prepare(
    "SELECT due_at FROM followups WHERE lead_id = ? AND status = 'pending' ORDER BY due_at ASC LIMIT 1",
  ).get(leadId);
  db.prepare('UPDATE leads SET next_follow_up_at = ? WHERE id = ?').run(next?.due_at || null, leadId);
  return next?.due_at || null;
}

export function cancelFollowUps(leadId) {
  db.prepare("UPDATE followups SET status = 'skipped' WHERE lead_id = ? AND status = 'pending'").run(leadId);
  db.prepare('UPDATE leads SET next_follow_up_at = NULL WHERE id = ?').run(leadId);
}

export function markMessageSent(messageId) {
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
  if (!message) throw new HttpError(404, 'Message not found');
  if (message.status === 'sent') throw new HttpError(409, 'This message is already marked as sent');
  if (message.status !== 'approved') throw new HttpError(403, 'Only approved messages can be marked as sent');

  assertSendAllowed();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(message.lead_id);
  if (!lead) throw new HttpError(404, 'Lead not found');

  const ts = nowIso();
  db.prepare("UPDATE messages SET status = 'sent', sent_at = ?, send_method = 'manual', updated_at = ? WHERE id = ?")
    .run(ts, ts, messageId);

  if (['new', 'reviewing', 'approved'].includes(lead.status)) {
    db.prepare("UPDATE leads SET status = 'contacted', last_contact_at = ?, updated_at = ? WHERE id = ?")
      .run(ts, ts, lead.id);
  } else {
    db.prepare('UPDATE leads SET last_contact_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, lead.id);
  }

  if (message.kind === 'initial') {
    scheduleInitialFollowUp(lead.id);
  } else {
    db.prepare(`
      UPDATE followups SET status = 'done', message_id = ?
      WHERE id = (
        SELECT id FROM followups WHERE lead_id = ? AND status = 'pending'
        ORDER BY due_at ASC LIMIT 1
      )
    `).run(messageId, lead.id);
    scheduleNextFollowUp(lead.id);
  }

  logActivity(
    message.kind === 'initial' ? 'message_sent' : 'followup_sent',
    `${message.kind === 'initial' ? 'First message' : 'Follow-up'} marked sent to ${lead.name}`,
    lead.id,
  );

  return {
    message: db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId),
    lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(lead.id),
  };
}

export function dueFollowUps(limit = 50) {
  return db.prepare(`
    SELECT f.id, f.due_at, f.status, f.lead_id, l.name AS lead_name, l.platform, l.profile_url,
           l.priority, l.category, l.status AS lead_status,
           (SELECT COUNT(*) FROM messages m WHERE m.lead_id = l.id AND m.kind = 'followup' AND m.status = 'sent') AS followups_sent
    FROM followups f JOIN leads l ON l.id = f.lead_id
    WHERE f.status = 'pending'
    ORDER BY f.due_at ASC LIMIT ?
  `).all(limit);
}
