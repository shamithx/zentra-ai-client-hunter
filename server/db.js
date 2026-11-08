import { DatabaseSync } from 'node:sqlite';
import { CONFIG } from './config.js';
import { decryptSecret, encryptSecret, hashPassword } from './lib/crypto.js';

export const db = new DatabaseSync(CONFIG.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    csrf TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    last_seen TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    secret INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    platform TEXT NOT NULL DEFAULT 'instagram',
    profile_url TEXT,
    post_url TEXT,
    country TEXT,
    category TEXT,
    followers INTEGER,
    website TEXT,
    email TEXT,
    context TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    source_query TEXT,
    signals TEXT NOT NULL DEFAULT '[]',
    why_fit TEXT,
    service_offer TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    score INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    tags TEXT NOT NULL DEFAULT '[]',
    dedupe_key TEXT NOT NULL UNIQUE,
    analysis_mode TEXT,
    analyzed_at TEXT,
    next_follow_up_at TEXT,
    last_contact_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'initial',
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    channel TEXT NOT NULL DEFAULT 'manual',
    tone TEXT,
    created_by TEXT,
    edited INTEGER NOT NULL DEFAULT 0,
    approved_at TEXT,
    sent_at TEXT,
    send_method TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS followups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    due_at TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id INTEGER,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lead_id INTEGER,
    type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS discovery_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    query TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    found INTEGER NOT NULL DEFAULT 0,
    added INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
  CREATE INDEX IF NOT EXISTS idx_leads_priority ON leads(priority);
  CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
  CREATE INDEX IF NOT EXISTS idx_messages_lead ON messages(lead_id);
  CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
  CREATE INDEX IF NOT EXISTS idx_followups_due ON followups(due_at, status);
  CREATE INDEX IF NOT EXISTS idx_activity_created ON activity(created_at);
`);

export const nowIso = () => new Date().toISOString();

const DEFAULT_SETTINGS = [
  ['brand.name', 'ZENTRA Creates', 0],
  ['brand.owner', 'Shamith', 0],
  ['brand.portfolio', 'https://zentra.createz.workers.dev/', 0],
  ['brand.instagram', 'https://www.instagram.com/zentra.creates/', 0],
  ['brand.services', 'Video Editing, Graphic Design, Social Media Content Creation', 0],
  ['brand.include_portfolio_link', 'false', 0],
  ['target.countries', 'United States, United Kingdom, Canada, Australia, New Zealand, Ireland', 0],
  ['outreach.min_seconds', '90', 0],
  ['outreach.max_per_day', '20', 0],
  ['outreach.followup_first_days', '3', 0],
  ['outreach.followup_second_days', '7', 0],
  ['ai.provider', 'none', 0],
  ['ai.base_url', '', 0],
  ['ai.model', '', 0],
  ['ai.api_key', '', 1],
  ['google.api_key', '', 1],
  ['google.cx', '', 0],
  ['meta.access_token', '', 1],
  ['meta.ig_user_id', '', 0],
  ['meta.page_id', '', 0],
  ['discovery.hashtags', 'videoeditorwanted,needvideoeditor,reelseditor,smallbusinesstips,contentcreator', 0],
];

export function seedSettings() {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, secret, updated_at) VALUES (?, ?, ?, ?)',
  );
  for (const [key, value, secret] of DEFAULT_SETTINGS) insert.run(key, value, secret, nowIso());
}

export function getSetting(key, fallback = '') {
  const row = db.prepare('SELECT value, secret FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  return row.secret ? decryptSecret(row.value) : row.value;
}

export function setSetting(key, value, secret = false) {
  db.prepare(`
    INSERT INTO settings (key, value, secret, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, secret = excluded.secret, updated_at = excluded.updated_at
  `).run(key, secret ? encryptSecret(value) : String(value ?? ''), secret ? 1 : 0, nowIso());
}

export function getPublicSettings() {
  const out = {};
  for (const [key, , secret] of DEFAULT_SETTINGS) {
    if (secret) {
      const value = getSetting(key);
      out[key] = value ? `••••••••${value.slice(-4)}` : '';
      out[`${key}__set`] = Boolean(value);
    } else {
      out[key] = getSetting(key);
    }
  }
  return out;
}

export function logActivity(type, detail, leadId = null) {
  db.prepare('INSERT INTO activity (lead_id, type, detail, created_at) VALUES (?, ?, ?, ?)')
    .run(leadId, type, detail, nowIso());
}

export function parseLeadRow(row) {
  if (!row) return null;
  return {
    ...row,
    signals: safeJson(row.signals, []),
    tags: safeJson(row.tags, []),
  };
}

export function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

seedSettings();

if (CONFIG.appPassword) {
  const existing = db.prepare('SELECT id FROM auth WHERE id = 1').get();
  if (!existing) {
    db.prepare('INSERT INTO auth (id, password_hash, created_at) VALUES (1, ?, ?)')
      .run(hashPassword(CONFIG.appPassword), nowIso());
    console.log('[db] Initial password created from APP_PASSWORD.');
  }
}
