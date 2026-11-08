import { db, logActivity, nowIso } from '../db.js';
import { analyzeHeuristic, inferCategory, inferCountry, isCompetitorText } from '../ai/scoring.js';

const IG_RESERVED = new Set(['p', 'reel', 'reels', 'explore', 'tv', 'stories', 'accounts', 'direct', 'share', 'about', 'developer']);
const FB_RESERVED = new Set(['login', 'share', 'watch', 'groups', 'events', 'reels', 'marketplace', 'photo', 'photos', 'permalink.php', 'story.php', 'reel', 'video.php', 'l.php', 'profile.php', 'people', 'help', 'policies', 'privacy']);

export function platformFromUrl(value) {
  const url = String(value || '').toLowerCase();
  if (url.includes('instagram.com')) return 'instagram';
  if (url.includes('facebook.com') || url.includes('fb.com')) return 'facebook';
  if (url.includes('tiktok.com')) return 'tiktok';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('linkedin.com')) return 'linkedin';
  return 'other';
}

export function cleanUrl(value) {
  if (!value) return '';
  let raw = String(value).trim();
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    url.search = '';
    url.hostname = url.hostname.toLowerCase().replace(/^(www\.|m\.|web\.)/, '');
    let path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.hostname}${path}`;
  } catch {
    return '';
  }
}

export function handleFromProfile(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (host.endsWith('instagram.com')) {
      if (!parts.length || IG_RESERVED.has(parts[0].toLowerCase())) return '';
      return parts[0].replace(/^@/, '');
    }
    if (host.endsWith('facebook.com') || host === 'fb.com') {
      if (!parts.length || FB_RESERVED.has(parts[0].toLowerCase())) return '';
      return parts[0];
    }
    if (host.endsWith('tiktok.com')) {
      return (parts[0] || '').replace(/^@/, '');
    }
    if (host.endsWith('youtube.com')) {
      const at = parts.find((part) => part.startsWith('@'));
      return at ? at.slice(1) : parts[1] || '';
    }
    if (host.endsWith('linkedin.com')) return parts[1] || '';
    return parts[0] || '';
  } catch {
    return '';
  }
}

export function profileUrlFromAny(url) {
  const platform = platformFromUrl(url);
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (platform === 'instagram') {
      const handle = handleFromProfile(url);
      return handle ? `https://www.instagram.com/${handle}` : '';
    }
    if (platform === 'facebook') {
      const handle = handleFromProfile(url);
      if (!handle) return '';
      if (handle === 'profile.php') return `https://www.facebook.com/${handle}${parsed.search}`;
      return `https://www.facebook.com/${handle}`;
    }
    if (platform === 'tiktok') {
      const handle = handleFromProfile(url);
      return handle ? `https://www.tiktok.com/@${handle}` : '';
    }
    if (platform === 'youtube') {
      const handle = handleFromProfile(url);
      return handle ? `https://www.youtube.com/@${handle}` : '';
    }
    if (platform === 'linkedin') return cleanUrl(url);
    return parts.length ? cleanUrl(url) : '';
  } catch {
    return '';
  }
}

export function nameFromUrl(url) {
  const handle = handleFromProfile(profileUrlFromAny(url) || url);
  if (!handle) return 'Unknown prospect';
  return handle
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim()
    .slice(0, 80);
}

export function dedupeKeyFor(lead) {
  const profile = cleanUrl(lead.profile_url);
  const post = cleanUrl(lead.post_url);
  const base = profile || post;
  const platform = lead.platform || platformFromUrl(base) || 'other';
  if (base) return `${platform}:${base.toLowerCase()}`;
  const slug = String(lead.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${platform}:name:${slug || 'unknown'}`;
}

export function normalizeCandidate(raw) {
  const postUrl = cleanUrl(raw.post_url || '');
  const profileUrl = cleanUrl(raw.profile_url || '') || profileUrlFromAny(postUrl);
  const platform = raw.platform || platformFromUrl(profileUrl || postUrl) || 'other';
  const name = String(raw.name || '').trim() || nameFromUrl(profileUrl || postUrl);
  return {
    name: name.slice(0, 120),
    platform,
    profile_url: profileUrl,
    post_url: postUrl && postUrl !== profileUrl ? postUrl : '',
    country: String(raw.country || '').trim().slice(0, 80),
    category: String(raw.category || '').trim().slice(0, 80),
    followers: Number.isFinite(Number(raw.followers)) && Number(raw.followers) > 0 ? Math.round(Number(raw.followers)) : null,
    website: cleanUrl(raw.website || ''),
    email: String(raw.email || '').trim().slice(0, 160),
    context: String(raw.context || '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    notes: String(raw.notes || '').trim().slice(0, 4000),
    source: String(raw.source || 'manual').slice(0, 40),
    source_query: String(raw.source_query || '').slice(0, 300),
    tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 12).map((tag) => String(tag).slice(0, 40)) : [],
  };
}

export function insertLead(raw, { allowCompetitor = true } = {}) {
  const candidate = normalizeCandidate(raw);
  const key = dedupeKeyFor(candidate);
  const existing = db.prepare('SELECT * FROM leads WHERE dedupe_key = ?').get(key);
  if (existing) {
    const merged = { ...existing };
    for (const field of ['context', 'notes', 'post_url', 'country', 'category', 'website', 'email']) {
      if (!existing[field] && candidate[field]) merged[field] = candidate[field];
    }
    if (!existing.followers && candidate.followers) merged.followers = candidate.followers;
    db.prepare(`
      UPDATE leads SET context = ?, notes = ?, post_url = ?, country = ?, category = ?,
        website = ?, email = ?, followers = ?, updated_at = ? WHERE id = ?
    `).run(merged.context, merged.notes, merged.post_url, merged.country, merged.category,
      merged.website, merged.email, merged.followers, nowIso(), existing.id);
    return { added: false, lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(existing.id), reason: 'duplicate' };
  }

  const combinedText = `${candidate.name} ${candidate.notes} ${candidate.context} ${candidate.source_query}`;
  if (!allowCompetitor && isCompetitorText(combinedText)) {
    return { added: false, lead: null, reason: 'competitor' };
  }

  const enriched = {
    ...candidate,
    category: candidate.category || inferCategory(candidate),
    country: candidate.country || inferCountry(candidate),
  };
  const analysis = analyzeHeuristic(enriched);
  const ts = nowIso();

  const result = db.prepare(`
    INSERT INTO leads (name, platform, profile_url, post_url, country, category, followers, website, email,
      context, notes, source, source_query, signals, why_fit, service_offer, priority, score, status,
      tags, dedupe_key, analysis_mode, analyzed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 'heuristic', ?, ?, ?)
  `).run(
    enriched.name, enriched.platform, enriched.profile_url, enriched.post_url,
    analysis.country || enriched.country, analysis.category, enriched.followers,
    enriched.website, enriched.email, enriched.context, enriched.notes,
    enriched.source, enriched.source_query, JSON.stringify(analysis.signals),
    analysis.why_fit, analysis.service_offer, analysis.priority, analysis.score,
    JSON.stringify(enriched.tags || []), key, ts, ts, ts,
  );

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(result.lastInsertRowid);
  logActivity('lead_added', `${lead.name} added from ${lead.source}`, lead.id);
  return { added: true, lead, reason: null };
}

export function extractUrls(text) {
  return [...String(text).matchAll(/https?:\/\/[^\s,|<>"']+/gi)].map((match) => match[0].replace(/[).]+$/, ''));
}

export function parseBulkText(text) {
  const candidates = [];
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const urls = extractUrls(trimmed);
    if (!urls.length) continue;
    const url = urls[0];
    let name = '';
    if (trimmed.includes('|')) {
      const parts = trimmed.split('|').map((part) => part.trim()).filter(Boolean);
      name = parts.find((part) => !/^https?:\/\//i.test(part)) || '';
    } else {
      name = trimmed.replace(url, '').replace(/[-–—:,\t]+$/g, '').replace(/^[-–—:,\t]+/g, '').trim();
    }
    const platform = platformFromUrl(url);
    candidates.push({
      name: name.slice(0, 120) || nameFromUrl(url),
      platform,
      profile_url: profileUrlFromAny(url) || cleanUrl(url),
      post_url: /instagram\.com\/(p|reel)\//.test(url) || /facebook\.com\/.+\/(posts|videos)\//.test(url) ? cleanUrl(url) : '',
      source: 'manual_paste',
    });
  }
  return candidates;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const input = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);

  if (!rows.length) return { candidates: [], header: false };

  const aliases = {
    name: ['name', 'business', 'business name', 'page', 'account', 'username'],
    platform: ['platform'],
    profile_url: ['profile_url', 'profile url', 'profile', 'url', 'link', 'page url'],
    post_url: ['post_url', 'post url', 'post'],
    country: ['country', 'location', 'market'],
    category: ['category', 'niche', 'industry'],
    followers: ['followers', 'follower count', 'audience'],
    website: ['website', 'site'],
    email: ['email', 'e-mail'],
    notes: ['notes', 'note', 'comments'],
    context: ['context', 'bio', 'caption', 'description'],
  };
  const headerRow = rows[0].map((cell) => cell.trim().toLowerCase());
  const isHeader = headerRow.some((cell) => aliases.name.includes(cell) || aliases.profile_url.includes(cell));
  if (!isHeader) {
    const candidates = [];
    for (const r of rows) {
      for (const cell of r) {
        if (/^https?:\/\//i.test(cell.trim())) {
          candidates.push(parseBulkText(cell)[0]);
          break;
        }
      }
    }
    return { candidates: candidates.filter(Boolean), header: false };
  }

  const index = {};
  for (const [fieldName, names] of Object.entries(aliases)) {
    const idx = headerRow.findIndex((cell) => names.includes(cell));
    if (idx !== -1) index[fieldName] = idx;
  }

  const candidates = [];
  for (const r of rows.slice(1)) {
    const obj = { source: 'csv_import' };
    for (const [fieldName, idx] of Object.entries(index)) {
      obj[fieldName] = (r[idx] || '').trim();
    }
    if (!obj.name && !obj.profile_url) continue;
    if (obj.profile_url && !obj.name) obj.name = nameFromUrl(obj.profile_url);
    candidates.push(obj);
  }
  return { candidates, header: true };
}

export function leadStatsForIds(ids) {
  if (!ids.length) return {};
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM leads WHERE id IN (${placeholders})`).all(...ids);
}
