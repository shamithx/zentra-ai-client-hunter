import { CONFIG } from './config.js';
import { db, nowIso } from './db.js';
import { hashPassword, randomToken, safeEqual, sha256, verifyPassword } from './lib/crypto.js';

const COOKIE = 'zh_session';
const loginAttempts = new Map();

export function hasPassword() {
  return Boolean(db.prepare('SELECT id FROM auth WHERE id = 1').get());
}

export function setPassword(password) {
  const hash = hashPassword(password);
  const existing = db.prepare('SELECT id FROM auth WHERE id = 1').get();
  if (existing) {
    db.prepare('UPDATE auth SET password_hash = ? WHERE id = 1').run(hash);
  } else {
    db.prepare('INSERT INTO auth (id, password_hash, created_at) VALUES (1, ?, ?)').run(hash, nowIso());
  }
}

export function checkPassword(password) {
  const row = db.prepare('SELECT password_hash FROM auth WHERE id = 1').get();
  if (!row) return false;
  return verifyPassword(password, row.password_hash);
}

export function checkPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Use at least 10 characters.';
  }
  if (password.length > 200) return 'Password is too long.';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Include at least one letter and one number.';
  }
  return null;
}

export function createSession(req) {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const created = new Date();
  const expires = new Date(created.getTime() + CONFIG.sessionDays * 86400_000);
  db.prepare(
    'INSERT INTO sessions (token_hash, csrf, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)',
  ).run(sha256(token), csrf, created.toISOString(), expires.toISOString(), created.toISOString());
  return { token, csrf, expires, cookie: sessionCookie(token, expires, req) };
}

export function sessionCookie(token, expires, req) {
  const secure = CONFIG.secureCookies || req.headers['x-forwarded-proto'] === 'https';
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Expires=${expires.toUTCString()}`,
    ...(secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function getSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(hash);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
    return null;
  }
  const last = new Date(row.last_seen).getTime();
  if (Date.now() - last > 3600_000) {
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(nowIso(), hash);
  }
  return { tokenHash: hash, csrf: row.csrf };
}

export function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyAllSessions() {
  db.prepare('DELETE FROM sessions').run();
}

export function verifyCsrf(req, session) {
  if (!session) return false;
  const token = req.headers['x-csrf-token'];
  return Boolean(token) && safeEqual(token, session.csrf);
}

export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients still need a session + CSRF token
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function loginThrottle(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, reset: Date.now() + 15 * 60_000 };
  if (Date.now() > entry.reset) {
    entry.count = 0;
    entry.reset = Date.now() + 15 * 60_000;
  }
  return {
    blocked: entry.count >= 8,
    retryAfter: Math.max(0, Math.ceil((entry.reset - Date.now()) / 1000)),
    fail() {
      entry.count += 1;
      loginAttempts.set(ip, entry);
    },
    reset() {
      loginAttempts.delete(ip);
    },
  };
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
  const cutoff = Date.now() - 15 * 60_000;
  for (const [ip, entry] of loginAttempts) {
    if (entry.reset < cutoff) loginAttempts.delete(ip);
  }
}
