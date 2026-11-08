import { getSetting } from '../db.js';
import { HttpError } from '../lib/http.js';
import { platformFromUrl, profileUrlFromAny } from '../lib/leads.js';

export const GOOGLE_PRESETS = [
  {
    label: 'Businesses asking for an editor',
    query: 'site:instagram.com ("looking for" OR "need") ("video editor" OR "reels editor" OR "video editing")',
  },
  {
    label: 'Facebook posts hiring editors',
    query: 'site:facebook.com ("looking for a video editor" OR "need a video editor" OR "video editor needed")',
  },
  {
    label: 'Creators who edit their own reels',
    query: 'site:instagram.com ("editing my reels" OR "edit my own reels" OR "need help editing")',
  },
  {
    label: 'Local businesses posting video',
    query: 'site:instagram.com ("restaurant" OR "real estate" OR "gym" OR "salon") ("reels" OR "promo video")',
  },
  {
    label: 'Small businesses with weak video',
    query: 'site:facebook.com ("small business" OR "local business") ("our new video" OR "behind the scenes")',
  },
  {
    label: 'Coaches and course sellers',
    query: 'site:instagram.com ("business coach" OR "online course") ("reels" OR "content creator")',
  },
];

function configured() {
  return Boolean(getSetting('google.api_key') && getSetting('google.cx'));
}

export function googleStatus() {
  return {
    ready: configured(),
    has_key: Boolean(getSetting('google.api_key')),
    has_cx: Boolean(getSetting('google.cx')),
    docs: 'https://developers.google.com/custom-search/v1/overview',
    free_quota: '100 search queries per day',
  };
}

function cleanTitle(title) {
  return String(title || '')
    .replace(/\s*[|•]\s*(Facebook|Instagram|Instagram photos and videos).*$/i, '')
    .replace(/\s*[-–]\s*(Home|Facebook|Instagram)$/i, '')
    .replace(/^Instagram\s*[|•]\s*/i, '')
    .trim();
}

function isJunkResult(item) {
  const text = `${item.title} ${item.snippet} ${item.link}`.toLowerCase();
  return (
    /log ?in|sign ?up|create new account|forgot password/.test(text) ||
    /\/accounts\/login|\/login|\/explore\/|\/reels\/audio|\/help\/|\/policies\//.test(item.link) ||
    /instagram photos and videos$/.test(item.title) && !/@/.test(item.title)
  );
}

export function candidateFromSearchResult(item, query) {
  const platform = platformFromUrl(item.link);
  const text = `${item.title || ''} ${item.snippet || ''}`;
  const handleMatch = text.match(/\(@([a-zA-Z0-9._]{2,40})\)/) || text.match(/@([a-zA-Z0-9._]{2,40})/);
  let profileUrl = profileUrlFromAny(item.link);
  if (!profileUrl && handleMatch && platform === 'instagram') {
    profileUrl = `https://www.instagram.com/${handleMatch[1]}`;
  }

  let name = cleanTitle(item.title);
  const beforeAt = name.split('(')[0].trim();
  if (beforeAt && beforeAt.length >= 2 && beforeAt.length <= 80) {
    name = beforeAt;
  } else if (handleMatch) {
    name = handleMatch[1];
  }
  if (!name || /^instagram$/i.test(name) || /^facebook$/i.test(name)) {
    name = handleMatch ? handleMatch[1] : 'Unknown prospect';
  }

  return {
    name,
    platform,
    profile_url: profileUrl,
    post_url: /instagram\.com\/(p|reel)\//.test(item.link) || /facebook\.com\/.+\/(posts|videos)\//.test(item.link)
      ? item.link
      : '',
    context: String(item.snippet || '').slice(0, 1200),
    source: 'google_cse',
    source_query: String(query || '').slice(0, 280),
  };
}

export async function googleSearch(query, limit = 10) {
  if (!configured()) {
    throw new HttpError(400, 'Google Programmable Search is not configured. Add an API key and Search Engine ID in Settings → Integrations.');
  }
  const key = getSetting('google.api_key');
  const cx = getSetting('google.cx');
  const trimmed = String(query || '').trim();
  if (!trimmed) throw new HttpError(400, 'Enter a search query');
  if (trimmed.length > 300) throw new HttpError(400, 'Query is too long');

  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', key);
  url.searchParams.set('cx', cx);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('num', String(Math.max(1, Math.min(10, limit))));
  url.searchParams.set('safe', 'active');

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  } catch (err) {
    throw new HttpError(502, `Could not reach Google Search: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error?.message || `Google Search returned ${res.status}`;
    if (res.status === 429) throw new HttpError(429, 'Google Search daily quota reached. Try again tomorrow or use guided discovery.');
    throw new HttpError(502, message.slice(0, 300));
  }

  const items = (data.items || []).filter((item) => !isJunkResult(item));
  const seen = new Set();
  const candidates = [];
  for (const item of items) {
    const candidate = candidateFromSearchResult(item, trimmed);
    const key = candidate.profile_url || candidate.post_url;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return { candidates, total_results: Number(data.searchInformation?.totalResults || 0) };
}

export async function testGoogle() {
  if (!configured()) throw new Error('Google API key or Search Engine ID missing');
  const url = new URL('https://www.googleapis.com/customsearch/v1');
  url.searchParams.set('key', getSetting('google.api_key'));
  url.searchParams.set('cx', getSetting('google.cx'));
  url.searchParams.set('q', 'site:instagram.com video editor');
  url.searchParams.set('num', '1');
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Google returned ${res.status}`);
  return true;
}
