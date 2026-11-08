import { analyzeHeuristic, inferCountry, normalizeCountry, scoreToPriority, serviceForCategory } from './scoring.js';
import { chatJson, aiConfig } from './llm.js';

const SYSTEM = `You are a lead qualification analyst for ZENTRA Creates, a video editing and design studio.
You assess whether a business or creator is a realistic client for video editing, reels editing, social content and graphic design.
Return strict JSON only. Never invent facts. If a detail is not in the input, use an empty string.
Score 0-100 where 100 is a perfect prospect. Be conservative: a lead with no evidence of video use should not score highly.
Signals must be short factual observations with a weight from -40 to 40 and kind "positive", "caution" or "negative".`;

export async function analyzeLead(lead) {
  const heuristic = analyzeHeuristic(lead);
  if (heuristic.disqualified) return { analysis: heuristic, warning: null };

  const cfg = aiConfig();
  if (!cfg.ready) {
    return {
      analysis: heuristic,
      warning: 'AI provider not configured — used local heuristic scoring. Add a provider key in Settings for deeper analysis.',
    };
  }

  const input = {
    name: lead.name,
    platform: lead.platform,
    profile_url: lead.profile_url,
    post_url: lead.post_url,
    country: lead.country,
    category: lead.category,
    followers: lead.followers,
    website: lead.website,
    email: lead.email,
    public_context: lead.context,
    user_notes: lead.notes,
    discovery_query: lead.source_query,
    heuristic_signals: heuristic.signals.map((signal) => signal.label),
  };

  try {
    const raw = await chatJson({
      system: SYSTEM,
      user: `Assess this prospect for ZENTRA Creates. Services: video editing, reels/TikTok editing, social content, graphic design, promotional videos.
Target markets: USA, UK, Canada, Australia, New Zealand, Ireland, UAE, Singapore.

Prospect data:
${JSON.stringify(input, null, 2)}

Return JSON with this exact shape:
{
  "category": "short business category",
  "country": "country name or empty string",
  "why_fit": "2-3 sentences grounded only in the data above",
  "service_offer": "one concrete service package to pitch",
  "score": 0-100 integer,
  "priority": "high|medium|low",
  "signals": [{"label": "short observation", "weight": number, "kind": "positive|caution|negative"}],
  "disqualified": false
}`,
      maxTokens: 800,
    });

    const score = Math.max(0, Math.min(100, Number(raw.score) || heuristic.score));
    const aiSignals = Array.isArray(raw.signals)
      ? raw.signals
          .filter((signal) => signal && typeof signal.label === 'string')
          .slice(0, 8)
          .map((signal) => ({
            label: signal.label.slice(0, 200),
            weight: Math.max(-40, Math.min(40, Number(signal.weight) || 0)),
            kind: ['positive', 'caution', 'negative'].includes(signal.kind) ? signal.kind : 'note',
          }))
      : [];

    const seen = new Set(heuristic.signals.map((signal) => signal.label.toLowerCase()));
    const mergedSignals = [...heuristic.signals];
    for (const signal of aiSignals) {
      if (!seen.has(signal.label.toLowerCase())) {
        mergedSignals.push(signal);
        seen.add(signal.label.toLowerCase());
      }
    }

    const country = normalizeCountry(raw.country) || heuristic.country || inferCountry(lead);
    const category = raw.category?.slice(0, 80) || heuristic.category;

    return {
      analysis: {
        category,
        country,
        why_fit: String(raw.why_fit || heuristic.why_fit).slice(0, 1200),
        service_offer: String(raw.service_offer || serviceForCategory(category)).slice(0, 400),
        priority: scoreToPriority(score),
        score,
        signals: mergedSignals.slice(0, 10),
        analysis_mode: 'ai',
        disqualified: Boolean(raw.disqualified),
      },
      warning: null,
    };
  } catch (err) {
    return {
      analysis: heuristic,
      warning: `AI analysis unavailable (${err.message.slice(0, 160)}). Used local heuristic scoring instead.`,
    };
  }
}
