import { TARGET_COUNTRIES } from '../config.js';

const CATEGORY_RULES = [
  { label: 'Food & Beverage', terms: ['restaurant', 'cafe', 'coffee', 'bakery', 'pizzeria', 'pizza', 'bar ', 'bistro', 'food truck', 'catering', 'kitchen', 'eatery', 'sushi', 'burger', 'dessert', 'juice', 'meal prep'] },
  { label: 'Real Estate', terms: ['real estate', 'realtor', 'property', 'properties', 'realty', 'estate agent', 'homes for sale', 'apartment', 'condo', 'letting'] },
  { label: 'Fitness & Wellness', terms: ['gym', 'fitness', 'personal trainer', 'yoga', 'pilates', 'crossfit', 'coach', 'workout', 'athlete', 'wellness', 'martial arts'] },
  { label: 'Beauty & Personal Care', terms: ['salon', 'barber', 'spa', 'beauty', 'makeup', 'cosmetic', 'skincare', 'nails', 'lash', 'aesthetic', 'hair studio', 'tattoo'] },
  { label: 'E-commerce', terms: ['shop', 'store', 'ecommerce', 'e-commerce', 'boutique', 'clothing', 'apparel', 'jewelry', 'jewellery', 'furniture', 'brand', 'product', 'skincare', 'supplement'] },
  { label: 'Creator', terms: ['creator', 'influencer', 'youtuber', 'podcaster', 'content creator', 'blogger', 'streamer', 'personal brand'] },
  { label: 'Travel & Hospitality', terms: ['travel', 'hotel', 'resort', 'airbnb', 'tour', 'villa', 'hostel', 'vacation', 'cruise', 'guest house'] },
  { label: 'Health & Medical', terms: ['clinic', 'dentist', 'dental', 'doctor', 'med spa', 'physio', 'chiropractor', 'healthcare', 'therapy', 'orthodont'] },
  { label: 'Professional Services', terms: ['law firm', 'lawyer', 'attorney', 'accountant', 'bookkeeping', 'consultant', 'consulting', 'agency', 'insurance', 'financial advisor', 'mortgage'] },
  { label: 'Home Services', terms: ['construction', 'builder', 'roofing', 'plumber', 'plumbing', 'electrician', 'landscaping', 'cleaning service', 'remodel', 'interior design', 'painter'] },
  { label: 'Education & Coaching', terms: ['school', 'academy', 'course', 'tutor', 'teacher', 'education', 'mentor', 'business coach', 'life coach', 'training'] },
  { label: 'Automotive', terms: ['car ', 'auto ', 'dealership', 'detailing', 'mechanic', 'motorcycle', 'motorsport', 'car wash', 'tyres', 'tires'] },
  { label: 'Pet Services', terms: ['pet ', 'dog ', 'puppy', 'groomer', 'veterinary', 'vet clinic', 'animal', 'cattery'] },
  { label: 'Events & Weddings', terms: ['wedding', 'events', 'planner', 'photographer', 'photography', 'videographer', 'venue', 'dj '] },
];

const SERVICE_BY_CATEGORY = {
  'Food & Beverage': 'Menu and offer reels, plus a short promo video for your venue',
  'Real Estate': 'Property tour videos and listing reels for agents',
  'Fitness & Wellness': 'Short-form coaching reels and a transformation-focused promo',
  'Beauty & Personal Care': 'Before/after reels and a polished brand promo video',
  'E-commerce': 'Product ad videos and UGC-style reels for paid social',
  'Creator': 'Reels editing, retention-focused cuts and thumbnail design',
  'Travel & Hospitality': 'Destination and stay reels plus a promo video',
  'Health & Medical': 'Clinic promo videos and trust-building short content',
  'Professional Services': 'Authority-building short videos and service promos',
  'Home Services': 'Before/after project reels and a local service promo',
  'Education & Coaching': 'Course promos and clean talking-head editing',
  'Automotive': 'Vehicle showcase reels and dealership promos',
  'Pet Services': 'Short-form content and a brand promo video',
  'Events & Weddings': 'Event highlight reels and cinematic teasers',
  'Small Business': 'Reels editing and a promotional video for social media',
};

const STRONG_INTENT = [
  'looking for a video editor', 'looking for video editor', 'need a video editor', 'need video editor',
  'video editor needed', 'hiring a video editor', 'hiring video editor', 'need help with editing',
  'need an editor', 'looking for an editor', 'editor needed', 'need help editing', 'editing my reels',
  'edit my reels', 'need my reels edited', 'need videos edited', 'need video editing', 'recommend a video editor',
  'recommend an editor', 'content creator needed', 'looking for content creator', 'need a content creator',
  'who edits your reels', 'dm me if you edit', 'video editor for hire',
];

const MEDIUM_INTENT = [
  'reels', 'tiktok', 'video', 'content', 'editing', 'promo', 'advertisement', 'commercial',
  'youtube', 'shorts', 'behind the scenes', 'ugc',
];

const NEGATIVE_INTENT = [
  'unpaid', 'for free', 'free work', 'exposure only', 'no budget', 'revenue share',
  'student needed', 'intern needed', 'internship',
];

const COMPETITOR_SIGNALS = [
  'i am a video editor', "i'm a video editor", 'i am an editor', 'available for work',
  'open for commissions', 'my editing services', 'we offer video editing', 'dm for rates',
  'my portfolio', 'hire me as your editor', 'freelance video editor here',
];

const LOW_QUALITY_SIGNALS = [
  'shot on phone', 'phone footage', 'raw footage', 'bad audio', 'vertical video', 'no editing',
  'just started posting', 'doing my own content', 'editing myself',
];

const COUNTRY_MATCHERS = [
  ['United States', /\b(usa|u\.s\.a|united states|new york|los angeles|chicago|houston|miami|dallas|atlanta|seattle|boston|phoenix|denver|las vegas|san diego|san francisco|austin|nashville|florida|texas|california)\b/i],
  ['United Kingdom', /\b(uk|u\.k\.|united kingdom|london|manchester|birmingham|leeds|glasgow|edinburgh|liverpool|bristol|england|scotland|wales)\b/i],
  ['Canada', /\b(canada|toronto|vancouver|montreal|calgary|ottawa|edmonton|winnipeg|ontario|quebec|british columbia)\b/i],
  ['Australia', /\b(australia|sydney|melbourne|brisbane|perth|adelaide|gold coast|canberra|queensland|victoria)\b/i],
  ['New Zealand', /\b(new zealand|auckland|wellington|christchurch|queenstown)\b/i],
  ['Ireland', /\b(ireland|dublin|cork|galway|limerick)\b/i],
  ['United Arab Emirates', /\b(dubai|abu dhabi|uae|united arab emirates)\b/i],
  ['Singapore', /\b(singapore)\b/i],
];

const COUNTRY_JSON_NAMES = {
  US: 'United States', USA: 'United States', 'United States': 'United States',
  UK: 'United Kingdom', GB: 'United Kingdom', 'United Kingdom': 'United Kingdom',
  CA: 'Canada', Canada: 'Canada', AU: 'Australia', Australia: 'Australia',
  NZ: 'New Zealand', 'New Zealand': 'New Zealand', IE: 'Ireland', Ireland: 'Ireland',
  AE: 'United Arab Emirates', 'United Arab Emirates': 'United Arab Emirates', SG: 'Singapore', Singapore: 'Singapore',
};

const normalize = (value) => String(value || '').toLowerCase();

export function isCompetitorText(text) {
  const t = normalize(text);
  return COMPETITOR_SIGNALS.some((phrase) => t.includes(phrase));
}

export function hasBuyingIntent(text) {
  const t = normalize(text);
  return STRONG_INTENT.some((phrase) => t.includes(phrase));
}

export function inferCategory(lead) {
  if (lead.category && lead.category !== 'Unknown') return lead.category;
  const text = `${lead.name} ${lead.notes || ''} ${lead.context || ''} ${lead.website || ''}`.toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const rule of CATEGORY_RULES) {
    const hits = rule.terms.filter((term) => text.includes(term)).length;
    if (hits > bestHits) {
      best = rule.label;
      bestHits = hits;
    }
  }
  return best || 'Small Business';
}

export function inferCountry(lead) {
  if (lead.country) {
    const cleaned = COUNTRY_JSON_NAMES[lead.country] || lead.country;
    return cleaned;
  }
  const text = `${lead.notes || ''} ${lead.context || ''} ${lead.location || ''}`;
  for (const [country, matcher] of COUNTRY_MATCHERS) {
    if (matcher.test(text)) return country;
  }
  return '';
}

function followerPoints(followers) {
  if (!Number.isFinite(followers) || followers <= 0) return { points: 0, signal: null };
  if (followers >= 2000 && followers <= 100000) {
    return { points: 12, signal: { label: `${followers.toLocaleString('en-US')} followers — ideal size for short-form video`, weight: 12, kind: 'positive' } };
  }
  if (followers > 100000 && followers <= 500000) {
    return { points: 7, signal: { label: `${followers.toLocaleString('en-US')} followers — established audience`, weight: 7, kind: 'positive' } };
  }
  if (followers > 500000) {
    return { points: 2, signal: { label: `${followers.toLocaleString('en-US')} followers — may already have a production team`, weight: 2, kind: 'note' } };
  }
  return { points: -4, signal: { label: `${followers.toLocaleString('en-US')} followers — early stage, budget may be limited`, weight: -4, kind: 'caution' } };
}

export function analyzeHeuristic(lead) {
  const text = `${lead.name} ${lead.notes || ''} ${lead.context || ''} ${lead.source_query || ''}`;
  const lower = text.toLowerCase();
  const signals = [];
  let score = 20;

  const category = inferCategory(lead);
  const country = inferCountry(lead);
  const targetCountries = ['United States', 'United Kingdom', 'Canada', 'Australia', 'New Zealand', 'Ireland', 'United Arab Emirates', 'Singapore'];
  const competitor = isCompetitorText(text);

  if (competitor) {
    return {
      category,
      country,
      why_fit: 'This account appears to offer editing services, so it is more likely a competitor than a client.',
      service_offer: '',
      priority: 'low',
      score: 5,
      signals: [{ label: 'Appears to be a competing editor or studio', weight: -40, kind: 'negative' }],
      analysis_mode: 'heuristic',
      disqualified: true,
    };
  }

  const intentHits = STRONG_INTENT.filter((phrase) => lower.includes(phrase));
  if (intentHits.length) {
    score += 34;
    signals.push({
      label: `Active buying intent: “${intentHits[0]}”`,
      weight: 34,
      kind: 'positive',
    });
  }

  const mediumHits = [...new Set(MEDIUM_INTENT.filter((word) => lower.includes(word)))];
  if (mediumHits.length) {
    const points = Math.min(14, mediumHits.length * 4);
    score += points;
    signals.push({
      label: `Already publishes video content (${mediumHits.slice(0, 3).join(', ')})`,
      weight: points,
      kind: 'positive',
    });
  }

  const negativeHits = NEGATIVE_INTENT.filter((phrase) => lower.includes(phrase));
  if (negativeHits.length) {
    score -= 25;
    signals.push({
      label: `Budget warning: “${negativeHits[0]}”`,
      weight: -25,
      kind: 'negative',
    });
  }

  const lowQualityHits = LOW_QUALITY_SIGNALS.filter((phrase) => lower.includes(phrase));
  if (lowQualityHits.length) {
    score += 8;
    signals.push({
      label: 'Content is self-produced — a professional edit would visibly improve it',
      weight: 8,
      kind: 'positive',
    });
  }

  if (['Food & Beverage', 'Beauty & Personal Care', 'Fitness & Wellness', 'E-commerce', 'Real Estate', 'Travel & Hospitality', 'Events & Weddings', 'Automotive'].includes(category)) {
    score += 14;
    signals.push({ label: `${category} is a strong visual category for reels and promos`, weight: 14, kind: 'positive' });
  } else if (category !== 'Small Business') {
    score += 8;
    signals.push({ label: `${category} businesses benefit from short-form video`, weight: 8, kind: 'positive' });
  }

  if (country) {
    if (targetCountries.includes(country)) {
      score += 9;
      signals.push({ label: `Based in a target market: ${country}`, weight: 9, kind: 'positive' });
    }
  } else {
    signals.push({ label: 'Country not confirmed — verify before outreach', weight: 0, kind: 'caution' });
  }

  if (lead.platform === 'instagram') {
    score += 7;
    signals.push({ label: 'Instagram-first business — reels are a direct fit', weight: 7, kind: 'positive' });
  } else if (lead.platform === 'facebook') {
    score += 3;
    signals.push({ label: 'Facebook page can reuse the same video across reels and ads', weight: 3, kind: 'positive' });
  }

  const follower = followerPoints(Number(lead.followers));
  score += follower.points;
  if (follower.signal) signals.push(follower.signal);

  if (lead.website) {
    score += 3;
    signals.push({ label: 'Has a website — likely has a marketing budget', weight: 3, kind: 'positive' });
  }
  if (lead.email) {
    score += 3;
    signals.push({ label: 'Public email available as a secondary contact route', weight: 3, kind: 'positive' });
  }
  if (lead.post_url) {
    score += 2;
    signals.push({ label: 'Specific public post available for personalisation', weight: 2, kind: 'positive' });
  }
  if (!lead.profile_url) {
    signals.push({ label: 'No profile URL — add one to verify the account', weight: 0, kind: 'caution' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const priority = score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';

  const whyParts = [];
  whyParts.push(`${lead.name} looks like a ${category.toLowerCase()} brand${country ? ` in ${country}` : ''}${lead.platform ? ` on ${lead.platform === 'instagram' ? 'Instagram' : lead.platform === 'facebook' ? 'Facebook' : lead.platform}` : ''}.`);
  if (intentHits.length) {
    whyParts.push('Their own wording shows they are actively looking for editing help right now.');
  } else if (follower.points >= 7) {
    whyParts.push('Their audience is large enough that consistent, professionally edited short videos should move the needle.');
  } else {
    whyParts.push('Their category relies on visual proof, which is exactly what short-form video sells.');
  }
  if (negativeHits.length) whyParts.push('The budget signal is weak, so qualify carefully before spending time.');
  if (!country) whyParts.push('Country still needs confirming from their bio or website.');

  return {
    category,
    country,
    why_fit: whyParts.join(' '),
    service_offer: SERVICE_BY_CATEGORY[category] || SERVICE_BY_CATEGORY['Small Business'],
    priority,
    score,
    signals,
    analysis_mode: 'heuristic',
    disqualified: false,
  };
}

export function serviceForCategory(category) {
  return SERVICE_BY_CATEGORY[category] || SERVICE_BY_CATEGORY['Small Business'];
}

export function scoreToPriority(score) {
  return score >= 65 ? 'high' : score >= 40 ? 'medium' : 'low';
}

export function normalizeCountry(value) {
  if (!value) return '';
  return COUNTRY_JSON_NAMES[value] || value;
}

export { TARGET_COUNTRIES, COUNTRY_JSON_NAMES };
