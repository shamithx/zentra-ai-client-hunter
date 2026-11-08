import { getSetting } from '../db.js';
import { chatJson, aiConfig } from './llm.js';
import { hasBuyingIntent, serviceForCategory } from './scoring.js';

const NICHE_PHRASE = {
  'Food & Beverage': 'restaurants and cafés',
  'Real Estate': 'real estate',
  'Fitness & Wellness': 'fitness',
  'Beauty & Personal Care': 'beauty',
  'E-commerce': 'e-commerce',
  'Creator': 'creators',
  'Travel & Hospitality': 'travel and hospitality',
  'Health & Medical': 'clinics',
  'Professional Services': 'service businesses',
  'Home Services': 'home service businesses',
  'Education & Coaching': 'coaches and educators',
  'Automotive': 'automotive',
  'Pet Services': 'pet businesses',
  'Events & Weddings': 'weddings and events',
  'Small Business': 'small businesses',
};

function looksLikeHandle(name) {
  return !name || (!/\s/.test(name) && /[._\d]/.test(name)) || /^[a-z0-9._]+$/.test(name);
}

const BUSINESS_WORDS = /\b(cafe|café|studio|group|realty|agency|shop|store|co|company|collective|designs?|clinic|salon|bar|grill|kitchen|bistro|gym|fitness|goods|brand|media|marketing|homes?|properties|tours?|events?|academy|consulting|services?|solutions|official)\b/i;

export function greetingName(name) {
  const clean = String(name || '').replace(/[^\p{L}\p{N}\s'&.-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!clean || looksLikeHandle(clean) || BUSINESS_WORDS.test(clean)) return 'there';
  const words = clean.split(/\s+/);
  if (words.length !== 2) return 'there';
  return words[0];
}

export function displayBusiness(name) {
  if (!name) return 'your page';
  let clean = String(name).replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\s/.test(clean) && /^[a-z0-9 ]+$/i.test(clean)) {
    clean = clean.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return clean.slice(0, 60) || 'your page';
}

function brand() {
  return {
    name: getSetting('brand.name', 'ZENTRA Creates'),
    owner: getSetting('brand.owner', ''),
    portfolio: getSetting('brand.portfolio', ''),
    instagram: getSetting('brand.instagram', ''),
    services: getSetting('brand.services', ''),
    includeLink: getSetting('brand.include_portfolio_link', 'false') === 'true',
  };
}

function cleanObservation(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[.!\s]+$/, '')
    .trim()
    .slice(0, 160);
}

function niche(category) {
  return NICHE_PHRASE[category] || 'small businesses';
}

function observationSentence(observation) {
  return observation ? `I liked how you ${observation.charAt(0).toLowerCase()}${observation.slice(1)}. ` : '';
}

export function heuristicMessage(lead, options = {}) {
  const { tone = 'friendly', observation = '', kind = 'initial', step = 1 } = options;
  const who = greetingName(lead.name);
  const business = displayBusiness(lead.name);
  const b = brand();
  const from = b.owner ? `I'm ${b.owner} from ${b.name}` : `I'm from ${b.name}`;
  const category = lead.category || 'Small Business';
  const categoryPhrase = niche(category);
  const intent = hasBuyingIntent(`${lead.notes || ''} ${lead.context || ''}`);
  const service = lead.service_offer || serviceForCategory(category);

  if (kind === 'followup') {
    if (step >= 2) {
      return `Hey ${who} — last note from me. If editing isn't a priority right now, no worries at all. If it becomes one, I'm around. Either way, I like what you're building with ${business}.`;
    }
    return `Hey ${who}, just floating this back up in case it got buried. Happy to put together two sample edits for ${business} so you can see the style — no charge and no obligation. Worth a look?`;
  }

  const obs = observationSentence(cleanObservation(observation));

  let body;
  if (intent) {
    body = `Hey ${who} — saw your post about needing editing help. ${from}, and we handle reels and promo edits for ${categoryPhrase}, so this is right in our lane. ${obs}Want me to send two relevant examples plus a quick idea for ${business}?`;
  } else if (tone === 'direct') {
    body = `Hey ${who} — quick one. ${from}. We edit reels and promo videos for ${categoryPhrase}, and ${business} looks like a strong fit. ${obs}Worth sending over two examples?`;
  } else if (tone === 'professional') {
    body = `Hi ${who}, ${from}, a video editing and design studio. I came across ${business} and thought there was a clear fit with what we do. ${obs}We help ${categoryPhrase} with reels editing, social content and promotional videos. Would you be open to seeing a couple of relevant examples?`;
  } else {
    body = `Hey ${who} — came across ${business} and really liked what you're building. ${obs}${from}, a video editing studio. We help ${categoryPhrase} turn raw clips into clean, scroll-stopping reels and promos. Open to seeing two examples we'd make for a page like yours?`;
  }

  if (b.includeLink && b.portfolio) {
    body += `\n\nPortfolio: ${b.portfolio}`;
  }

  return body.replace(/\s+\n/g, '\n').trim();
}

const SYSTEM = `You write first-contact Instagram and Facebook direct messages for ZENTRA Creates, a small video editing and design studio.
Rules:
- Sound like a real freelancer, warm and specific, never like an agency or a template.
- 2 to 4 short sentences, under 90 words total.
- Reference only facts supplied in the input. Never invent details about their content.
- Exactly one clear question at the end.
- No links unless include_link is true.
- No hashtags, no emojis, no "I hope this message finds you well", no "Dear Sir/Madam", no hype words.
- Do not claim you have watched or edited their videos.
- Return strict JSON: {"message": "..."}.`;

export async function generateMessage(lead, options = {}) {
  const { tone = 'friendly', observation = '', kind = 'initial', step = 1 } = options;
  const b = brand();
  const fallback = heuristicMessage(lead, options);
  const cfg = aiConfig();
  if (!cfg.ready) return { body: fallback, mode: 'heuristic', warning: null };

  try {
    const result = await chatJson({
      system: SYSTEM,
      user: `Studio: ${b.name}. Owner name: ${b.owner || 'not provided'}. Services: ${b.services}.
Portfolio: ${b.portfolio}. Instagram: ${b.instagram}. Include portfolio link: ${b.includeLink ? 'yes, once at the end' : 'no'}.

Prospect:
${JSON.stringify({
        name: lead.name,
        platform: lead.platform,
        country: lead.country,
        category: lead.category,
        followers: lead.followers,
        bio_or_caption: lead.context,
        notes: lead.notes,
        match_reason: lead.why_fit,
        suggested_service: lead.service_offer || serviceForCategory(lead.category || 'Small Business'),
        observation_from_user: cleanObservation(observation),
        message_kind: kind,
        follow_up_number: kind === 'followup' ? step : null,
        tone,
      }, null, 2)}

If message_kind is "followup", write a brief, low-pressure follow-up. For follow_up_number 2 or higher, make it a polite final note that leaves the door open.`,
      maxTokens: 500,
      temperature: 0.7,
    });
    const body = String(result.message || '').trim();
    if (body.length < 20 || body.length > 1200) return { body: fallback, mode: 'heuristic', warning: 'AI message was out of range — used the local template.' };
    return { body, mode: 'ai', warning: null };
  } catch (err) {
    return { body: fallback, mode: 'heuristic', warning: `AI message unavailable (${err.message.slice(0, 140)}). Used the local template.` };
  }
}

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
