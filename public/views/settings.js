import { api, downloadUrl, setCsrf } from '../api.js';
import {
  applySizes, confirmDialog, copyText, esc, icon, relTime, setButtonBusy, setPageActions, toast,
} from '../ui.js';

const SECTIONS = [
  ['brand', 'Brand'],
  ['outreach', 'Outreach safety'],
  ['ai', 'AI assistant'],
  ['google', 'Google Search'],
  ['meta', 'Instagram API'],
  ['data', 'Data & privacy'],
  ['security', 'Security'],
  ['remote', 'Remote access'],
];

const AI_PROVIDERS = [
  ['none', 'Heuristic only (no key)'],
  ['openai', 'OpenAI'],
  ['openrouter', 'OpenRouter'],
  ['groq', 'Groq'],
  ['ollama', 'Ollama (local)'],
  ['custom', 'Custom OpenAI-compatible'],
];

const AI_DEFAULTS = {
  openai: 'https://api.openai.com/v1 · gpt-4o-mini',
  openrouter: 'https://openrouter.ai/api/v1 · openai/gpt-4o-mini',
  groq: 'https://api.groq.com/openai/v1 · llama-3.3-70b-versatile',
  ollama: 'http://localhost:11434/v1 · llama3.1 (no key needed)',
  custom: 'Any /v1 endpoint that supports chat completions',
  none: 'Deterministic scoring and templates always work without a provider.',
};

function pill(ready, label) {
  return `<span class="status-pill ${ready ? 'on' : 'off'}"><span class="dot"></span>${esc(label)}</span>`;
}

function secretField({ id, key, label, hint, value, placeholder }) {
  const saved = Boolean(value) && String(value).startsWith('••');
  return `<div class="field">
    <label for="${id}">${esc(label)}</label>
    <div class="secret-field">
      <input class="input" id="${id}" name="${esc(key)}" type="password" autocomplete="new-password" placeholder="${esc(placeholder || (saved ? `Saved (${String(value).slice(-4)}) — leave blank to keep` : 'Paste your key'))}" />
    </div>
    <span class="set-note">${icon('shield')} ${esc(saved ? `Stored encrypted · ends in ${String(value).slice(-4)}` : (hint || 'Encrypted at rest with AES-256-GCM.'))}</span>
  </div>`;
}

export async function renderSettings(el, ctx) {
  setPageActions('');
  el.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Loading settings…</span></div>`;

  let data;
  try {
    data = await api('/settings');
  } catch (err) {
    el.innerHTML = `<div class="empty"><h3>Could not load settings</h3><p>${esc(err.message)}</p><button class="btn" data-retry>Try again</button></div>`;
    el.querySelector('[data-retry]').addEventListener('click', () => renderSettings(el, ctx));
    return;
  }

  let active = ctx.query?.get('section') || 'brand';
  if (active === 'integrations') active = 'integrations';
  if (!SECTIONS.some(([key]) => key === active) && active !== 'integrations') active = 'brand';

  const state = { data, active };

  function draw() {
    const { settings, integrations, quota, version, sample_leads, remote } = state.data;
    el.innerHTML = `
      <div class="page-head">
        <div>
          <p class="eyebrow">Workspace</p>
          <h2>Settings</h2>
          <p>Brand voice, safety limits and optional integrations. Everything is stored locally and secrets are encrypted at rest.</p>
        </div>
        <div class="page-actions">
          <a class="btn btn-ghost" href="#/leads">${icon('users')} Back to leads</a>
        </div>
      </div>

      <div class="settings-grid">
        <nav class="settings-nav" aria-label="Settings sections">
          ${SECTIONS.map(([key, label]) => `<button data-section="${key}" class="${state.active === key ? 'active' : ''}">${esc(label)}</button>`).join('')}
        </nav>
        <div class="settings-pane" data-pane></div>
      </div>`;

    el.querySelectorAll('[data-section]').forEach((button) => {
      button.addEventListener('click', () => {
        state.active = button.dataset.section;
        history.replaceState(null, '', `#/settings?section=${state.active}`);
        draw();
      });
    });

    const pane = el.querySelector('[data-pane]');
    if (state.active === 'brand') pane.innerHTML = brandSection(settings);
    else if (state.active === 'outreach') pane.innerHTML = outreachSection(settings, quota);
    else if (state.active === 'ai') pane.innerHTML = aiSection(settings, integrations.ai);
    else if (state.active === 'google') pane.innerHTML = googleSection(settings, integrations.google);
    else if (state.active === 'meta') pane.innerHTML = metaSection(settings, integrations.meta);
    else if (state.active === 'data') pane.innerHTML = dataSection(version, sample_leads);
    else if (state.active === 'security') pane.innerHTML = securitySection();
    else if (state.active === 'remote') pane.innerHTML = remoteSection(remote || {});
    else pane.innerHTML = integrationsSection(integrations);

    bind(pane, settings);
    applySizes(pane);
  }

  function setData(next) {
    if (next.settings) state.data.settings = next.settings;
    if (next.integrations) state.data.integrations = next.integrations;
  }

  async function save(section, form, button) {
    const updates = {};
    const formData = new FormData(form);
    for (const [key, value] of formData.entries()) {
      if (value === '' && key.endsWith('api_key')) continue;
      if (value === '' && key.endsWith('access_token')) continue;
      updates[key] = value;
    }
    for (const input of form.querySelectorAll('input[type="checkbox"][name]')) {
      updates[input.name] = input.checked ? 'true' : 'false';
    }
    if (!Object.keys(updates).length) {
      toast('Nothing changed', 'warn');
      return;
    }
    setButtonBusy(button, true, 'Saving');
    try {
      const res = await api('/settings', { method: 'PUT', body: { updates } });
      setData(res);
      toast(`${section} settings saved`);
      document.dispatchEvent(new CustomEvent('data:changed'));
      draw();
    } catch (err) {
      toast(err.message, 'error');
      setButtonBusy(button, false);
    }
  }

  function bind(pane, settings) {
    pane.querySelectorAll('[data-save]').forEach((form) => {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        save(form.dataset.save, form, form.querySelector('[data-submit]'));
      });
    });

    pane.querySelectorAll('[data-copy]').forEach((button) => {
      button.addEventListener('click', async () => {
        const ok = await copyText(button.dataset.copy);
        toast(ok ? 'Copied to clipboard' : 'Could not copy — select the text manually', ok ? 'success' : 'error');
      });
    });

    pane.querySelectorAll('[data-test]').forEach((button) => {
      button.addEventListener('click', async () => {
        const provider = button.dataset.test;
        setButtonBusy(button, true, 'Testing');
        try {
          const res = await api(`/settings/test/${provider}`, { method: 'POST', body: {} });
          toast(res.detail || 'Connection works');
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          setButtonBusy(button, false);
        }
      });
    });

    pane.querySelectorAll('[data-goto]').forEach((button) => {
      button.addEventListener('click', () => {
        state.active = button.dataset.goto;
        history.replaceState(null, '', `#/settings?section=${state.active}`);
        draw();
      });
    });

    const providerSelect = pane.querySelector('#ai-provider');
    providerSelect?.addEventListener('change', () => {
      const hint = pane.querySelector('[data-ai-default]');
      if (hint) hint.textContent = AI_DEFAULTS[providerSelect.value] || '';
    });

    pane.querySelector('[data-seed]')?.addEventListener('click', async () => {
      try {
        const res = await api('/settings/demo-data', { method: 'POST', body: {} });
        toast(`${res.added} sample leads loaded`);
        document.dispatchEvent(new CustomEvent('data:changed'));
        state.data.sample_leads = 8;
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    pane.querySelector('[data-remove-samples]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Remove sample data?',
        message: 'The eight fictional sample leads and any messages on them will be deleted. Real leads are untouched.',
        confirmLabel: 'Remove samples',
        danger: true,
      });
      if (!ok) return;
      try {
        const res = await api('/settings/demo-data', { method: 'DELETE' });
        toast(`${res.removed} sample lead${res.removed === 1 ? '' : 's'} removed`);
        document.dispatchEvent(new CustomEvent('data:changed'));
        state.data.sample_leads = 0;
        draw();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    pane.querySelector('[data-password-form]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const formData = new FormData(form);
      const current = formData.get('current');
      const next = formData.get('next');
      if (next !== formData.get('confirm')) {
        toast('New passwords do not match', 'error');
        return;
      }
      const button = form.querySelector('[data-submit]');
      setButtonBusy(button, true, 'Updating');
      try {
        const res = await api('/auth/password', { method: 'POST', body: { current, next } });
        setCsrf(res.csrf);
        form.reset();
        toast('Password updated. Other sessions were signed out.');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        setButtonBusy(button, false);
      }
    });
  }

  draw();
}

function brandSection(settings) {
  return `<form data-save="Brand">
    <div class="card">
      <h3>ZENTRA brand</h3>
      <p>These details ground every AI draft and appear in the app chrome.</p>
      <div class="form-grid">
        <div class="field"><label for="brand-name">Brand name</label><input class="input" id="brand-name" name="brand.name" value="${esc(settings['brand.name'])}" maxlength="80" required /></div>
        <div class="field"><label for="brand-owner">Your name</label><input class="input" id="brand-owner" name="brand.owner" value="${esc(settings['brand.owner'])}" maxlength="60" placeholder="Shamith" /></div>
        <div class="field"><label for="brand-portfolio">Portfolio URL</label><input class="input" id="brand-portfolio" name="brand.portfolio" type="url" value="${esc(settings['brand.portfolio'])}" maxlength="500" placeholder="https://zentra.createz.workers.dev/" /></div>
        <div class="field"><label for="brand-instagram">Instagram URL</label><input class="input" id="brand-instagram" name="brand.instagram" type="url" value="${esc(settings['brand.instagram'])}" maxlength="500" placeholder="https://www.instagram.com/zentra.creates/" /></div>
        <div class="field span-2"><label for="brand-services">Services</label><input class="input" id="brand-services" name="brand.services" value="${esc(settings['brand.services'])}" maxlength="300" /></div>
      </div>
      <div class="mt-14">
        <label class="switch"><input type="checkbox" name="brand.include_portfolio_link" ${settings['brand.include_portfolio_link'] === 'true' ? 'checked' : ''} /><span class="track"></span><span>Include the portfolio link in first drafts</span></label>
        <p class="set-note">${icon('alert')} Links can reduce DM deliverability. Off by default — offer examples instead.</p>
      </div>
      <div class="settings-actions"><button class="btn btn-primary" data-submit>${icon('check')} Save brand settings</button></div>
    </div>
  </form>`;
}

function outreachSection(settings, quota) {
  return `<form data-save="Outreach">
    <div class="card">
      <h3>Manual send limits</h3>
      <p>ZENTRA never sends messages. These limits apply when you mark a message as sent, and exist to keep your account safe.</p>
      <div class="form-grid">
        <div class="field"><label for="min-seconds">Minimum gap between sends (seconds)</label><input class="input" id="min-seconds" name="outreach.min_seconds" type="number" min="30" max="3600" value="${esc(settings['outreach.min_seconds'])}" /><span class="hint">30–3600. Default 90 seconds.</span></div>
        <div class="field"><label for="max-day">Maximum sends per day</label><input class="input" id="max-day" name="outreach.max_per_day" type="number" min="1" max="100" value="${esc(settings['outreach.max_per_day'])}" /><span class="hint">1–100. Default 20 — a safety ceiling, not a target.</span></div>
        <div class="field"><label for="first-days">First follow-up after (days)</label><input class="input" id="first-days" name="outreach.followup_first_days" type="number" min="1" max="30" value="${esc(settings['outreach.followup_first_days'])}" /></div>
        <div class="field"><label for="second-days">Second follow-up after (days)</label><input class="input" id="second-days" name="outreach.followup_second_days" type="number" min="2" max="60" value="${esc(settings['outreach.followup_second_days'])}" /></div>
      </div>
      <div class="row-between mt-14">
        <span class="tiny muted">Today: ${quota.used} of ${quota.max} manual sends used${quota.nextAllowedAt ? ` · next send ${esc(relTime(quota.nextAllowedAt))}` : ''}.</span>
        <span class="tiny muted">Maximum two follow-ups per prospect.</span>
      </div>
      <div class="settings-actions"><button class="btn btn-primary" data-submit>${icon('check')} Save outreach limits</button></div>
    </div>
    <div class="card">
      <h3>Approval rule</h3>
      <p>This is fixed on purpose and cannot be switched off.</p>
      <div class="notice">${icon('shield')}<div><strong>Every message requires explicit approval.</strong> Editing an approved message resets approval. Your send confirmation starts the follow-up timer. Anti-spam checks block duplicate, promotional or all-caps text before it can be approved.</div></div>
    </div>
  </form>`;
}

function aiSection(settings, status) {
  const provider = settings['ai.provider'] || 'none';
  return `<form data-save="AI">
    <div class="card">
      <div class="panel-head">
        <div><h3>AI assistant</h3><p>Optional. Without it, deterministic scoring and template drafts keep working.</p></div>
        ${pill(status.ready, status.ready ? 'Ready' : 'Off')}
      </div>
      <div class="form-grid">
        <div class="field"><label for="ai-provider">Provider</label>
          <select class="select" id="ai-provider" name="ai.provider">${AI_PROVIDERS.map(([value, label]) => `<option value="${value}" ${provider === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select>
          <span class="hint" data-ai-default>${esc(AI_DEFAULTS[provider] || '')}</span>
        </div>
        <div class="field"><label for="ai-model">Model</label><input class="input" id="ai-model" name="ai.model" value="${esc(settings['ai.model'])}" maxlength="120" placeholder="gpt-4o-mini" /><span class="hint">Leave blank to use the provider default.</span></div>
        <div class="field span-2"><label for="ai-base">Base URL</label><input class="input" id="ai-base" name="ai.base_url" type="url" value="${esc(settings['ai.base_url'])}" maxlength="500" placeholder="https://api.openai.com/v1" /><span class="hint">Any OpenAI-compatible endpoint. Ollama works locally with no key.</span></div>
        ${secretField({
          id: 'ai-key',
          key: 'ai.api_key',
          label: 'API key',
          value: settings['ai.api_key'],
          placeholder: settings['ai.api_key__set'] ? `Saved (${String(settings['ai.api_key']).slice(-4)}) — leave blank to keep` : 'sk-…',
          hint: 'Encrypted at rest. Never exposed to the browser after saving.',
        })}
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" data-submit>${icon('check')} Save AI settings</button>
        <button type="button" class="btn" data-test="ai" ${status.ready ? '' : 'disabled'}>${icon('sparkles')} Test connection</button>
      </div>
    </div>
    <div class="card">
      <h3>What AI adds</h3>
      <p>AI improves fit rationale and draft quality. It is never allowed to invent facts about a prospect.</p>
      <div class="notice">${icon('sparkles')}<div><strong>Grounding.</strong> Prompts pass only the public text you supplied. Drafts must reference real details, stay short, and avoid hype. Every output is still reviewed by you before approval.</div></div>
    </div>
  </form>`;
}

function googleSection(settings, status) {
  return `<form data-save="Google">
    <div class="card">
      <div class="panel-head">
        <div><h3>Google Programmable Search</h3><p>Free tier: 100 queries per day. Optional but useful for finding public posts and profiles.</p></div>
        ${pill(status.ready, status.ready ? 'Connected' : 'Not configured')}
      </div>
      <div class="form-grid">
        ${secretField({
          id: 'google-key',
          key: 'google.api_key',
          label: 'API key',
          value: settings['google.api_key'],
          placeholder: settings['google.api_key__set'] ? `Saved (${String(settings['google.api_key']).slice(-4)}) — leave blank to keep` : 'AIza…',
        })}
        <div class="field"><label for="google-cx">Search engine ID (cx)</label><input class="input" id="google-cx" name="google.cx" value="${esc(settings['google.cx'])}" maxlength="100" placeholder="e.g. 017576662512468239146:omuauf_lfve" /><span class="hint">From Programmable Search Engine → Setup → Search engine ID.</span></div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary" data-submit>${icon('check')} Save Google settings</button>
        <button type="button" class="btn" data-test="google" ${status.ready ? '' : 'disabled'}>${icon('search')} Test connection</button>
        <a class="btn btn-ghost" href="${esc(status.docs)}" target="_blank" rel="noopener">${icon('external')} API docs</a>
      </div>
    </div>
    <div class="card">
      <h3>Setup</h3>
      <p>Two pieces are needed: a key and an engine.</p>
      <div class="steps">
        <div class="step"><b>1</b><span>Enable the Custom Search API in Google Cloud Console and create an API key.</span></div>
        <div class="step"><b>2</b><span>Create a Programmable Search Engine at programmablesearchengine.google.com. You can restrict it to instagram.com and facebook.com.</span></div>
        <div class="step"><b>3</b><span>Copy the Search engine ID (cx) here. No billing is required for the 100/day free tier.</span></div>
      </div>
    </div>
  </form>`;
}

function metaSection(settings, status) {
  return `<form data-save="Instagram">
    <div class="card">
      <div class="panel-head">
        <div><h3>Instagram Graph API</h3><p>Optional. Reads public data from professional accounts only.</p></div>
        ${pill(status.ready, status.ready ? 'Connected' : 'Not configured')}
      </div>
      <div class="notice mb-18">${icon('alert')}<div><strong>Meta does not permit cold DMs through its APIs.</strong> This integration is discovery-only. It searches public hashtags and looks up public business profiles; it can never send a message. Outreach stays manual and approved by you.</div></div>
      <div class="form-grid">
        ${secretField({
          id: 'meta-token',
          key: 'meta.access_token',
          label: 'Access token',
          value: settings['meta.access_token'],
          placeholder: settings['meta.access_token__set'] ? `Saved (${String(settings['meta.access_token']).slice(-4)}) — leave blank to keep` : 'EAAG…',
          hint: 'Use a long-lived token from a Meta app with the required permissions.',
        })}
        <div class="field"><label for="meta-ig">Instagram business user ID</label><input class="input" id="meta-ig" name="meta.ig_user_id" value="${esc(settings['meta.ig_user_id'])}" maxlength="30" placeholder="17841400000000000" /><span class="hint">Numeric. The IG account linked to your Facebook Page.</span></div>
        <div class="field"><label for="meta-page">Facebook Page ID</label><input class="input" id="meta-page" name="meta.page_id" value="${esc(settings['meta.page_id'])}" maxlength="30" placeholder="102938475610293" /><span class="hint">Optional. Helps with page-level permissions.</span></div>
      </div>
      <div class="chip-row mt-14">${(status.permissions_needed || []).map((permission) => `<span class="chip">${esc(permission)}</span>`).join('')}</div>
      <div class="settings-actions">
        <button class="btn btn-primary" data-submit>${icon('check')} Save Instagram settings</button>
        <button type="button" class="btn" data-test="meta" ${status.ready ? '' : 'disabled'}>${icon('instagram')} Test connection</button>
        <a class="btn btn-ghost" href="${esc(status.docs)}" target="_blank" rel="noopener">${icon('external')} API docs</a>
      </div>
    </div>
    <div class="card">
      <h3>Requirements</h3>
      <p>${esc(status.note)}</p>
      <div class="notice">${icon('shield')}<div>Follow the platform terms: no scraping private data, no automation of logins or CAPTCHAs, and no automated messaging. The guided search and bulk paste routes need none of this setup.</div></div>
    </div>
  </form>`;
}

function dataSection(version, sampleCount) {
  return `<div class="card">
    <h3>Sample data</h3>
    <p>Eight fictional leads for exploring scoring, drafting and approvals. They are labelled <span class="badge sample">Sample</span> and never contact anyone.</p>
    <div class="row-between">
      <span class="tiny muted">${sampleCount} sample lead${sampleCount === 1 ? '' : 's'} currently loaded</span>
      <div class="row">
        <button class="btn btn-sm" data-seed ${sampleCount ? 'disabled' : ''}>${icon('plus')} Load samples</button>
        <button class="btn btn-sm btn-danger" data-remove-samples ${sampleCount ? '' : 'disabled'}>${icon('trash')} Remove samples</button>
      </div>
    </div>
  </div>
  <div class="card">
    <h3>Your data</h3>
    <p>Everything lives in a local SQLite database on this machine. Nothing is uploaded except the text sent to an AI, Google or Meta provider when you explicitly use those integrations.</p>
    <div class="form-grid">
      <div class="detail"><span>Storage</span><strong>Local SQLite (WAL)</strong></div>
      <div class="detail"><span>Secrets</span><strong>AES-256-GCM at rest</strong></div>
      <div class="detail"><span>Version</span><strong>v${esc(version)}</strong></div>
      <div class="detail"><span>Session</span><strong>HttpOnly · SameSite=Strict</strong></div>
    </div>
    <div class="settings-actions">
      <a class="btn" href="${downloadUrl('/leads/export.csv')}" download>${icon('download')} Export all leads (CSV)</a>
      <a class="btn btn-ghost" href="#/leads">${icon('users')} Open leads</a>
    </div>
  </div>
  <div class="card">
    <h3>Compliance boundaries</h3>
    <p>Built to stay inside platform rules and common-sense outreach.</p>
    <div class="steps">
      <div class="step"><b>1</b><span>Discovery uses public content through permitted search routes. No scraping of private data and no bypassing logins, rate limits or CAPTCHAs.</span></div>
      <div class="step"><b>2</b><span>Messages are copy-and-send by hand. No automated DMs, bulk sends or fake engagement.</span></div>
      <div class="step"><b>3</b><span>Every message is approved by you. Daily limits and a minimum gap between sends are enforced server-side.</span></div>
      <div class="step"><b>4</b><span>Honour opt-outs immediately. If someone asks you to stop, mark the lead rejected and do not follow up.</span></div>
    </div>
  </div>`;
}

function securitySection() {
  return `<form data-password-form>
    <div class="card">
      <h3>Change dashboard password</h3>
      <p>At least 10 characters with a letter and a number. Updating signs out every other session.</p>
      <div class="form-grid">
        <div class="field span-2"><label for="pw-current">Current password</label><input class="input" id="pw-current" name="current" type="password" autocomplete="current-password" required /></div>
        <div class="field"><label for="pw-next">New password</label><input class="input" id="pw-next" name="next" type="password" autocomplete="new-password" minlength="10" required /></div>
        <div class="field"><label for="pw-confirm">Confirm new password</label><input class="input" id="pw-confirm" name="confirm" type="password" autocomplete="new-password" minlength="10" required /></div>
      </div>
      <div class="settings-actions"><button class="btn btn-primary" data-submit>${icon('shield')} Update password</button></div>
    </div>
  </form>
  <div class="card">
    <h3>How it is protected</h3>
    <div class="steps">
      <div class="step"><b>1</b><span>Passwords are hashed with scrypt. Sessions use random tokens stored server-side (hashed) with CSRF protection.</span></div>
      <div class="step"><b>2</b><span>API keys are encrypted with AES-256-GCM using a key derived from your local app secret.</span></div>
      <div class="step"><b>3</b><span>Mutations require a same-origin request and a matching CSRF token. Login attempts are throttled.</span></div>
      <div class="step"><b>4</b><span>The server binds to <span class="mono">HOST</span> from <span class="mono">.env</span> (default <span class="mono">0.0.0.0</span> so your phone can connect). Set <span class="mono">HOST=127.0.0.1</span> to keep it on this computer only. Nothing is exposed to the public internet unless you start a tunnel yourself.</span></div>
    </div>
  </div>`;
}

function remoteSection(remote) {
  const port = remote.port || 8787;
  const lan = Array.isArray(remote.lan_urls) ? remote.lan_urls : [];
  const primary = lan[0];
  const lanTarget = primary ? primary.url : `http://YOUR-PC-IP:${port}`;
  const tunnelCommand = `cloudflared tunnel --url http://127.0.0.1:${port}`;
  const others = lan.slice(1);

  return `<div class="card">
    <div class="panel-head">
      <div><h3>Remote access</h3><p>Open this dashboard from your phone. The app stays local-first — nothing is published unless you start a tunnel yourself.</p></div>
      ${pill(Boolean(remote.lan_enabled), remote.lan_enabled ? 'LAN enabled' : 'This PC only')}
    </div>
    <div class="form-grid">
      <div class="detail"><span>This computer</span><strong>${esc(remote.local_url || `http://127.0.0.1:${port}`)}</strong></div>
      <div class="detail"><span>Same WiFi</span><strong>${esc(primary ? primary.url : (remote.lan_enabled ? 'No LAN address found' : `Off · HOST=${remote.host || '127.0.0.1'}`))}</strong></div>
      <div class="detail"><span>Bound to</span><strong>${esc(remote.host || '0.0.0.0')}:${esc(port)}</strong></div>
      <div class="detail"><span>Session cookies</span><strong>${remote.secure_cookies ? 'Secure always' : 'Auto Secure on HTTPS'}</strong></div>
    </div>
    ${primary ? `<div class="settings-actions"><button class="btn btn-sm" data-copy="${esc(primary.url)}">${icon('copy')} Copy phone URL</button>${others.length ? `<span class="tiny muted">Other adapters: ${others.map((item) => esc(item.url)).join(' · ')}</span>` : ''}</div>` : ''}
    ${remote.lan_enabled ? '' : `<div class="notice mt-14">${icon('alert')}<div><strong>LAN access is off.</strong> Set <span class="mono">HOST=0.0.0.0</span> in <span class="mono">.env</span> and restart the server to let another device connect.</div></div>`}
  </div>

  <div class="card">
    <h3>Method 1 — Same WiFi (LAN)</h3>
    <p>Fastest option. The phone and this computer must be on the same network.</p>
    <div class="steps">
      <div class="step"><b>1</b><span>Run the server with <span class="mono">HOST=0.0.0.0</span> (the default). Restart it after changing <span class="mono">.env</span>.</span></div>
      <div class="step"><b>2</b><span>Connect the phone to the same WiFi and open <strong>${esc(lanTarget)}</strong>.</span></div>
      <div class="step"><b>3</b><span>Sign in with your dashboard password. The session lasts 14 days per browser.</span></div>
      <div class="step"><b>4</b><span>If it does not load, allow Node.js in Windows Firewall for the current network profile (Private or Public), or allow inbound TCP ${esc(port)}.</span></div>
    </div>
    <pre class="cmd">HOST=0.0.0.0
node server/index.js</pre>
    <p class="set-note">${icon('alert')} Only use this on WiFi you trust. Anyone on the same network can reach the login page; your password is the gate. If your phone is the hotspot, it often cannot reach tethered devices — use Method 2 instead.</p>
  </div>

  <div class="card">
    <div class="panel-head">
      <div><h3>Method 2 — Cloudflare Tunnel (recommended for anywhere)</h3><p>No router ports and no paid plan. Gives an HTTPS link that works on mobile data.</p></div>
      ${pill(false, 'Free')}
    </div>
    <div class="steps">
      <div class="step"><b>1</b><span>Install cloudflared on this PC: <span class="mono">winget install --id Cloudflare.cloudflared</span> (macOS: <span class="mono">brew install cloudflared</span>).</span></div>
      <div class="step"><b>2</b><span>Keep the app local (<span class="mono">HOST=127.0.0.1</span>) and run the tunnel in a second terminal.</span></div>
      <div class="step"><b>3</b><span>Open the <span class="mono">https://….trycloudflare.com</span> link it prints, on your phone.</span></div>
      <div class="step"><b>4</b><span>The quick-tunnel URL changes on every restart. For a stable hostname plus login protection, use a named tunnel with Cloudflare Access.</span></div>
    </div>
    <pre class="cmd">${esc(tunnelCommand)}</pre>
    <div class="settings-actions">
      <button class="btn btn-sm" data-copy="${esc(tunnelCommand)}">${icon('copy')} Copy command</button>
      <a class="btn btn-sm btn-ghost" href="https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-local-tunnel/" target="_blank" rel="noopener">${icon('external')} Cloudflare docs</a>
    </div>
    <div class="notice mt-14">${icon('shield')}<div><strong>A quick tunnel is public.</strong> Anyone with the link can reach the login page, so use a long dashboard password and close the tunnel when you are done.</div></div>
  </div>

  <div class="card">
    <div class="panel-head">
      <div><h3>Method 3 — Tailscale (private)</h3><p>Reach this computer from anywhere without a public URL. Encrypted device-to-device; free personal plan.</p></div>
      ${pill(false, 'Free')}
    </div>
    <div class="steps">
      <div class="step"><b>1</b><span>Install Tailscale on this PC and on your phone, then sign in to the same account.</span></div>
      <div class="step"><b>2</b><span>Keep <span class="mono">HOST=0.0.0.0</span> and find this PC's Tailscale IP with <span class="mono">tailscale ip -4</span>.</span></div>
      <div class="step"><b>3</b><span>On the phone open <span class="mono">http://100.x.y.z:${esc(port)}</span>. Works on WiFi and mobile data.</span></div>
      <div class="step"><b>4</b><span>Nothing is on the public internet — only devices in your Tailnet can connect, and the dashboard password still applies.</span></div>
    </div>
    <pre class="cmd">tailscale ip -4</pre>
    <div class="settings-actions">
      <button class="btn btn-sm" data-copy="tailscale ip -4">${icon('copy')} Copy command</button>
      <a class="btn btn-sm btn-ghost" href="https://tailscale.com/download" target="_blank" rel="noopener">${icon('external')} Download Tailscale</a>
    </div>
  </div>

  <div class="card">
    <h3>Security notes</h3>
    <div class="steps">
      <div class="step"><b>1</b><span>Set a strong dashboard password before enabling LAN access or a tunnel. Login attempts are throttled per IP.</span></div>
      <div class="step"><b>2</b><span>Do not port-forward ${esc(port)} on your router. Use Cloudflare Tunnel or Tailscale instead.</span></div>
      <div class="step"><b>3</b><span>Over HTTPS, session cookies are marked Secure automatically via <span class="mono">x-forwarded-proto</span>. Set <span class="mono">SECURE_COOKIES=true</span> only if you always use HTTPS — plain-HTTP LAN logins would stop working.</span></div>
      <div class="step"><b>4</b><span>Remote access changes nothing about outreach: messages are still copied, sent by hand and confirmed by you.</span></div>
      <div class="step"><b>5</b><span>Stop the server or the tunnel when you are done, especially on shared or public WiFi.</span></div>
    </div>
  </div>`;
}

function integrationsSection(integrations) {
  const rows = [
    ['AI assistant', 'sparkles', integrations.ai.ready, integrations.ai.ready ? `${integrations.ai.provider} · ${integrations.ai.model}` : 'Heuristic scoring and template drafts still work', 'ai'],
    ['Google Search', 'search', integrations.google.ready, integrations.google.ready ? 'Programmable Search connected · 100 free queries/day' : 'Guided search and bulk paste still work', 'google'],
    ['Instagram API', 'instagram', integrations.meta.ready, integrations.meta.ready ? 'Graph API connected for public discovery' : 'Guided hashtag search and bulk paste still work', 'meta'],
  ];
  return `<div class="card">
    <h3>Integrations</h3>
    <p>All integrations are optional. The app is fully usable without any paid service or API key.</p>
    ${rows.map(([name, glyph, ready, detail, section]) => `<div class="integration">
      <span class="integration-icon">${icon(glyph)}</span>
      <div class="integration-text"><strong>${esc(name)}</strong><span>${esc(detail)}</span></div>
      ${pill(ready, ready ? 'Ready' : 'Optional')}
      <button class="btn btn-sm btn-ghost" data-goto="${section}">Configure</button>
    </div>`).join('')}
  </div>
  <div class="card">
    <h3>No keys required</h3>
    <div class="steps">
      <div class="step"><b>1</b><span>Guided public searches open Instagram, Facebook and Google search with useful queries pre-filled.</span></div>
      <div class="step"><b>2</b><span>Bulk paste adds profiles or posts you found manually, with deduplication and competitor filtering.</span></div>
      <div class="step"><b>3</b><span>CSV import and manual entry cover referrals, directories and your own research.</span></div>
      <div class="step"><b>4</b><span>Heuristic scoring, message templates and the full approval workflow run with no external service.</span></div>
    </div>
  </div>`;
}
