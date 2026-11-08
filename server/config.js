import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, 'data');

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch {
  // .env is optional
}

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadAppSecret() {
  if (process.env.APP_SECRET && process.env.APP_SECRET.length >= 16) {
    return process.env.APP_SECRET;
  }
  const keyFile = path.join(DATA_DIR, '.app_secret');
  try {
    const existing = fs.readFileSync(keyFile, 'utf8').trim();
    if (existing.length >= 16) return existing;
  } catch {
    // generate below
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(keyFile, secret, { mode: 0o600 });
  console.warn('[config] APP_SECRET not set — generated data/.app_secret. Keep this file private.');
  return secret;
}

export const CONFIG = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || '0.0.0.0',
  appSecret: loadAppSecret(),
  secureCookies: process.env.SECURE_COOKIES === 'true',
  appPassword: process.env.APP_PASSWORD || '',
  dbFile: path.join(DATA_DIR, 'zentra.db'),
  sessionDays: 14,
  version: '1.0.0',
};

export const TARGET_COUNTRIES = [
  'United States', 'USA', 'US', 'United Kingdom', 'UK', 'England', 'Canada',
  'Australia', 'New Zealand', 'Ireland', 'United Arab Emirates', 'UAE', 'Dubai',
  'Singapore', 'Germany', 'Netherlands', 'Sweden', 'Norway', 'Denmark', 'Switzerland',
];

export const PRIORITIES = ['high', 'medium', 'low'];
export const LEAD_STATUSES = ['new', 'reviewing', 'approved', 'contacted', 'responded', 'converted', 'rejected'];
export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'other'];
