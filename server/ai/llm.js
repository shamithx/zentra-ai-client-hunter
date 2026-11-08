import { getSetting } from '../db.js';

const PROVIDERS = {
  openai: { base: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyless: false },
  openrouter: { base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyless: false },
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyless: false },
  ollama: { base: 'http://localhost:11434/v1', model: 'llama3.1', keyless: true },
  custom: { base: '', model: '', keyless: false },
};

export function aiConfig() {
  const provider = getSetting('ai.provider', 'none');
  const preset = PROVIDERS[provider] || PROVIDERS.none || {};
  const baseUrl = (getSetting('ai.base_url') || preset.base || '').replace(/\/+$/, '');
  const model = getSetting('ai.model') || preset.model || '';
  const apiKey = getSetting('ai.api_key');
  const ready = Boolean(
    provider && provider !== 'none' && baseUrl && model && (apiKey || preset.keyless),
  );
  return { provider, baseUrl, model, apiKey, ready, keyless: Boolean(preset.keyless) };
}

export function aiStatus() {
  const cfg = aiConfig();
  return {
    provider: cfg.provider,
    model: cfg.model,
    base_url: cfg.baseUrl,
    ready: cfg.ready,
  };
}

function extractJson(text) {
  let cleaned = String(text || '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('Model did not return JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

export async function chatJson({ system, user, maxTokens = 900, temperature = 0.4 }) {
  const cfg = aiConfig();
  if (!cfg.ready) throw new Error('AI provider is not configured');

  const body = {
    model: cfg.model,
    temperature,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    response_format: { type: 'json_object' },
  };

  const doRequest = async (payload) => {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`AI request failed (${res.status}): ${text.slice(0, 300)}`);
      err.status = res.status;
      err.raw = text;
      throw err;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('AI provider returned an invalid response');
    }
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI provider returned an empty response');
    return extractJson(content);
  };

  try {
    return await doRequest(body);
  } catch (err) {
    if (err.status === 400 && /response_format|json_object|json mode/i.test(err.raw || '')) {
      const { response_format: _ignored, ...fallback } = body;
      return doRequest(fallback);
    }
    throw err;
  }
}

export async function testAi() {
  const result = await chatJson({
    system: 'You reply with strict JSON only.',
    user: 'Reply with exactly {"ok": true}.',
    maxTokens: 30,
    temperature: 0,
  });
  return Boolean(result?.ok);
}
