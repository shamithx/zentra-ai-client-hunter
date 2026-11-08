import { getSetting } from '../db.js';
import { HttpError } from '../lib/http.js';

const GRAPH = 'https://graph.facebook.com/v21.0';

function token() {
  return getSetting('meta.access_token');
}

function igUserId() {
  return getSetting('meta.ig_user_id');
}

export function metaStatus() {
  return {
    ready: Boolean(token() && igUserId()),
    has_token: Boolean(token()),
    has_ig_user_id: Boolean(igUserId()),
    hashtag_authors: false,
    permissions_needed: ['instagram_basic', 'pages_show_list', 'pages_read_engagement'],
    note: 'Requires an Instagram Business or Creator account linked to a Facebook Page, plus a Meta app with the permissions above. Profile lookup (Business Discovery) and hashtag author handles need Advanced Access, which Meta only grants after App Review. Until then use Guided search or Bulk import.',
    docs: 'https://developers.facebook.com/docs/instagram-api/guides/hashtag-search',
  };
}

async function graphGet(path, params = {}) {
  if (!token()) {
    throw new HttpError(400, 'Meta access token is not configured. Add it in Settings → Integrations.');
  }
  const url = new URL(`${GRAPH}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('access_token', token());

  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new HttpError(502, `Could not reach Meta Graph API: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const err = data?.error || {};
    const message = err.message || `Meta API returned ${res.status}`;
    if (err.code === 4 || err.code === 32 || err.code === 613 || /limit/i.test(message)) {
      throw new HttpError(429, `Meta rate limit: ${message.slice(0, 240)}`);
    }
    if (err.code === 190) {
      throw new HttpError(401, 'Meta access token is invalid or expired. Generate a new long-lived token.');
    }
    if (err.code === 10) {
      throw new HttpError(
        403,
        'Meta blocks this until the app passes App Review: Business Discovery needs Advanced Access for instagram_basic and pages_read_engagement. Add prospects with Guided search or Bulk import in the meantime.',
      );
    }
    throw new HttpError(502, message.slice(0, 300));
  }
  return data;
}

export async function lookupBusiness(username) {
  const igId = igUserId();
  if (!igId) throw new HttpError(400, 'Instagram Business account ID is not configured.');
  const clean = String(username || '').replace(/^@/, '').trim();
  if (!/^[a-zA-Z0-9._]{2,40}$/.test(clean)) throw new HttpError(400, 'Enter a valid Instagram username');
  const data = await graphGet(`/${igId}`, {
    fields: `business_discovery.username(${clean}){name,username,followers_count,media_count,biography,website,profile_picture_url}`,
  });
  const profile = data.business_discovery;
  if (!profile) throw new HttpError(404, 'Profile not found or not a professional account');
  return profile;
}

export async function hashtagSearch(tag, { limit = 25, enrich = true } = {}) {
  if (!igUserId()) {
    throw new HttpError(400, 'Instagram Business account ID is not configured. Add it in Settings → Integrations.');
  }
  const clean = String(tag || '').replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 60);
  if (!clean) throw new HttpError(400, 'Enter a hashtag');

  const found = await graphGet('/ig_hashtag_search', { user_id: igUserId(), q: clean });
  const hashtagId = found.data?.[0]?.id;
  if (!hashtagId) return { candidates: [], hashtag: clean, note: 'No public media found for this hashtag.' };

  // Meta removed `username` from hashtag media fields, so author handles cannot be resolved from here.
  const media = await graphGet(`/${hashtagId}/recent_media`, {
    user_id: igUserId(),
    fields: 'id,caption,media_type,permalink,timestamp,like_count,comments_count',
    limit: Math.max(1, Math.min(50, limit)),
  });

  const scanned = media.data?.length || 0;
  if (scanned && !media.data.some((item) => item.username)) {
    return {
      candidates: [],
      hashtag: clean,
      note: `Meta returned ${scanned} posts from #${clean} but no author handles. Instagram no longer exposes hashtag authors to apps without Advanced Access, so add prospects with Guided search or Bulk import.`,
    };
  }

  const byUser = new Map();
  for (const item of media.data || []) {
    if (!item.username) continue;
    const entry = byUser.get(item.username) || {
      username: item.username,
      posts: 0,
      likes: 0,
      comments: 0,
      latest: item,
    };
    entry.posts += 1;
    entry.likes += Number(item.like_count || 0);
    entry.comments += Number(item.comments_count || 0);
    if (new Date(item.timestamp) > new Date(entry.latest.timestamp)) entry.latest = item;
    byUser.set(item.username, entry);
  }

  const top = [...byUser.values()].sort((a, b) => b.likes + b.comments - (a.likes + a.comments)).slice(0, 20);
  const candidates = [];

  for (const entry of top) {
    let profile = null;
    if (enrich) {
      try {
        profile = await lookupBusiness(entry.username);
      } catch (err) {
        if (err.status === 429) throw err;
        profile = null;
      }
    }
    const context = [
      entry.latest.caption || '',
      `Recent #${clean} post: ${entry.posts} in sample, ${entry.likes} likes, ${entry.comments} comments.`,
      profile?.biography || '',
    ].filter(Boolean).join(' ').slice(0, 2000);

    candidates.push({
      name: profile?.name || entry.username,
      platform: 'instagram',
      profile_url: `https://www.instagram.com/${entry.username}`,
      post_url: entry.latest.permalink || '',
      followers: profile?.followers_count || null,
      website: profile?.website || '',
      category: '',
      context,
      source: 'meta_hashtag',
      source_query: `#${clean}`,
      tags: [`#${clean}`],
    });
  }

  return { candidates, hashtag: clean, note: `Scanned ${media.data?.length || 0} recent public posts from #${clean}.` };
}

export async function testMeta() {
  if (!token()) throw new Error('Meta access token missing');
  const data = await graphGet('/me', { fields: 'id,name' });
  return data?.name || data?.id || 'connected';
}
