import { api } from '../api.js';
import {
  esc, icon, relTime, setButtonBusy, setPageActions, toast,
} from '../ui.js';

const PROVIDER_LABELS = {
  google_cse: 'Google search',
  meta_hashtag: 'Instagram hashtag',
  manual_paste: 'Bulk paste',
};

function statusPill(ready, label) {
  return `<span class="status-pill ${ready ? 'on' : 'off'}"><span class="dot"></span>${esc(label)}</span>`;
}

function resultHtml(result) {
  if (!result) return '';
  const stats = [
    ['Found', result.found || 0, ''],
    ['Added', result.added || 0, 'good'],
    ['Duplicates', result.duplicates || 0, ''],
    ['Filtered', result.competitors || 0, ''],
  ];
  return `<div class="run-result">
    <div class="result-stats">
      ${stats.map(([label, value, variant]) => `<div class="result-stat ${variant}"><strong>${value}</strong>${esc(label)}</div>`).join('')}
    </div>
    ${result.leads?.length ? `<div class="result-leads">
      ${result.leads.map((lead) => `<a class="chip" href="#/leads?q=${encodeURIComponent(lead.name)}">${icon('users')} ${esc(lead.name)}</a>`).join('')}
    </div>` : `<p class="tiny muted">${result.added ? '' : 'No new prospects were added. Everything found was already in the pipeline or filtered out.'}</p>`}
    ${result.note ? (result.found ? `<p class="caveat">${esc(result.note)}</p>` : `<div class="notice">${icon('alert')}<div>${esc(result.note)}</div></div>`) : ''}
    ${result.skipped_examples?.length ? `<p class="tiny muted mt-12">Filtered as editing-service accounts: ${esc(result.skipped_examples.join(', '))}</p>` : ''}
    <a class="link mt-12" href="#/leads">Review the pipeline ${icon('arrow-right')}</a>
  </div>`;
}

export async function renderDiscovery(el, ctx) {
  setPageActions(`<a class="btn btn-ghost" href="#/leads">${icon('users')} All leads</a>`);
  el.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Checking available sources…</span></div>`;

  let presets;
  let runs = [];
  try {
    [presets, { runs }] = await Promise.all([api('/discovery/presets'), api('/discovery/runs')]);
  } catch (err) {
    el.innerHTML = `<div class="empty"><h3>Could not load discovery</h3><p>${esc(err.message)}</p><button class="btn" data-retry>Try again</button></div>`;
    el.querySelector('[data-retry]').addEventListener('click', () => renderDiscovery(el, ctx));
    return;
  }

  const google = presets.integrations.google;
  const meta = presets.integrations.meta;
  const firstQuery = presets.google_presets?.[0]?.query || '';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Prospecting</p>
        <h2>Discovery</h2>
        <p>All four routes use public information. Start without any API keys, then connect free providers when you want more volume.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="#/settings?section=integrations">${icon('sliders')} Integrations</a>
        <a class="btn" href="#/leads?status=new">${icon('filter')} Triage new leads</a>
      </div>
    </div>

    <div class="discovery-grid">
      <div class="card">
        <div class="provider-head">
          <span class="provider-icon paste">${icon('search')}</span>
          <div><h3>Guided public searches</h3><p>No keys. Opens the platform search you already have access to.</p></div>
          ${statusPill(true, 'Always available')}
        </div>
        <div class="guided-list">
          ${presets.guided.map((item) => `<a class="guided-link" href="${esc(item.url)}" target="_blank" rel="noopener" title="${esc(item.note)}">
            ${icon(item.platform === 'facebook' ? 'facebook' : item.platform === 'instagram' ? 'instagram' : 'search')}
            <span>${esc(item.label)}</span>
            ${icon('external')}
          </a>`).join('')}
        </div>
        <p class="caveat">Open a search, review public results, then paste the profile or post URLs into <strong>Bulk paste</strong>. Add only accounts that genuinely look like a fit.</p>
      </div>

      <div class="card">
        <div class="provider-head">
          <span class="provider-icon google">${icon('globe')}</span>
          <div><h3>Google Programmable Search</h3><p>Public web and social results, ${esc(google.free_quota || '100 queries/day')}.</p></div>
          ${statusPill(google.ready, google.ready ? 'Connected' : 'Optional')}
        </div>
        ${google.ready ? `
          <div class="form-grid">
            <div class="field span-2"><label for="g-query">Search query</label><input class="input" id="g-query" maxlength="300" value="${esc(firstQuery)}" placeholder="site:instagram.com small business video editing" /></div>
            <div class="field"><label for="g-limit">Results to check</label><select class="select" id="g-limit"><option value="5">5</option><option value="10" selected>10</option></select></div>
            <div class="field field-end"><button class="btn btn-primary" data-run="google">${icon('search')} Run search</button></div>
          </div>
          <div class="chip-row mt-14">
            ${(presets.google_presets || []).slice(0, 4).map((preset) => `<button class="chip" data-preset="${esc(preset.query)}">${esc(preset.label)}</button>`).join('')}
          </div>
          <p class="caveat">Uses ${esc(google.free_quota || '100 free queries/day')}. Results are filtered for editing-service competitors before they reach your pipeline.</p>
          <div data-result="google"></div>
        ` : `
          <div class="notice">${icon('alert')}<div><strong>Optional integration.</strong> Add a Google API key and Programmable Search engine ID in Settings. The free tier covers ${esc(google.free_quota || '100 queries/day')}. Until then, use the guided links and bulk paste.</div></div>
          <div class="settings-actions">
            <a class="btn btn-sm" href="#/settings?section=google">Configure Google</a>
            <a class="btn btn-sm btn-ghost" href="${esc(google.docs)}" target="_blank" rel="noopener">${icon('external')} API docs</a>
          </div>
        `}
      </div>

      <div class="card">
        <div class="provider-head">
          <span class="provider-icon meta">${icon('instagram')}</span>
          <div><h3>Instagram hashtags</h3><p>Public professional accounts posting under your chosen tags.</p></div>
          ${statusPill(meta.ready, meta.ready ? 'Connected' : 'Optional')}
        </div>
        ${meta.ready ? `
          <div class="form-grid">
            <div class="field"><label for="m-tag">Hashtag</label><input class="input" id="m-tag" maxlength="60" value="${esc(presets.hashtags?.[0] || 'videoeditorwanted')}" placeholder="videoeditorwanted" /></div>
            <div class="field"><label for="m-limit">Accounts to check</label><select class="select" id="m-limit"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option></select></div>
          </div>
          <label class="switch mt-14"><input type="checkbox" id="m-enrich" checked /><span class="track"></span><span>Look up follower counts and bios (slower)</span></label>
          <div class="settings-actions"><button class="btn btn-primary" data-run="meta">${icon('search')} Search hashtag</button></div>
          <p class="caveat">Instagram only returns public data for professional accounts. Accounts that advertise editing services are skipped.</p>
          ${meta.hashtag_authors === false ? `<div class="notice">${icon('alert')}<div><strong>This search will return 0 accounts.</strong> Meta stopped returning hashtag post authors to apps without App Review, so there is no username to build a lead from. Use Guided search and Bulk import instead — they need no Meta approval.</div></div>` : ''}
          <div data-result="meta"></div>
        ` : `
          <div class="notice">${icon('alert')}<div><strong>Needs a Meta app and an Instagram Business account.</strong> ${esc(meta.note)}</div></div>
          <div class="settings-actions">
            <a class="btn btn-sm" href="#/settings?section=meta">Configure Instagram API</a>
            <a class="btn btn-sm btn-ghost" href="${esc(meta.docs)}" target="_blank" rel="noopener">${icon('external')} API docs</a>
          </div>
          <p class="caveat">Without it, the hashtag links on the left open Instagram directly. Review recent posts there and paste the profiles you want.</p>
          <div class="chip-row mt-14">
            ${(presets.hashtags || []).map((tag) => `<a class="chip" href="https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/" target="_blank" rel="noopener">#${esc(tag)} ${icon('external')}</a>`).join('')}
          </div>
        `}
      </div>

      <div class="card">
        <div class="provider-head">
          <span class="provider-icon paste">${icon('copy')}</span>
          <div><h3>Bulk paste public URLs</h3><p>The reliable fallback. Paste profiles or posts you found yourself.</p></div>
          ${statusPill(true, 'Always available')}
        </div>
        <div class="field">
          <label for="b-text">Profile or post URLs — one per line</label>
          <textarea class="input" id="b-text" rows="7" placeholder="https://www.instagram.com/harborandhearthcafe/&#10;https://www.facebook.com/northlinerealty&#10;https://www.instagram.com/p/CxamplePost/"></textarea>
          <span class="hint">Up to 200 URLs. Duplicates are merged and editing-service accounts are filtered automatically.</span>
        </div>
        <div class="settings-actions"><button class="btn btn-primary" data-run="bulk">${icon('download')} Add to pipeline</button></div>
        <p class="caveat">Only paste links to public profiles or posts. Do not use scraped private data, exported contact lists, or anything behind a login.</p>
        <div data-result="bulk"></div>
      </div>
    </div>

    <div class="card">
      <div class="panel-head">
        <div><h3>Recent discovery runs</h3><p>Every search is logged with what it found and added</p></div>
        <span class="tiny muted">${runs.length} recent</span>
      </div>
      <div data-runs>${runsHtml(runs)}</div>
    </div>`;

  el.querySelectorAll('[data-preset]').forEach((chip) => {
    chip.addEventListener('click', () => {
      el.querySelector('#g-query').value = chip.dataset.preset;
      el.querySelector('#g-query').focus();
    });
  });

  async function run(kind, button) {
    let path;
    let body;
    if (kind === 'google') {
      const query = el.querySelector('#g-query').value.trim();
      if (!query) {
        toast('Enter a search query first', 'warn');
        return;
      }
      path = '/discovery/google';
      body = { query, limit: Number(el.querySelector('#g-limit').value) };
    } else if (kind === 'meta') {
      const tag = el.querySelector('#m-tag').value.trim().replace(/^#/, '');
      if (!tag) {
        toast('Enter a hashtag first', 'warn');
        return;
      }
      path = '/discovery/meta-hashtag';
      body = { tag, limit: Number(el.querySelector('#m-limit').value), enrich: el.querySelector('#m-enrich').checked };
    } else {
      const text = el.querySelector('#b-text').value.trim();
      if (!text) {
        toast('Paste at least one public URL', 'warn');
        return;
      }
      path = '/discovery/bulk';
      body = { text };
    }

    setButtonBusy(button, true, 'Searching');
    const resultEl = el.querySelector(`[data-result="${kind}"]`);
    resultEl.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Checking public results…</span></div>`;
    try {
      const result = await api(path, { method: 'POST', body });
      resultEl.innerHTML = resultHtml(result);
      toast(`${result.added} new lead${result.added === 1 ? '' : 's'} added from ${result.found} result${result.found === 1 ? '' : 's'}`);
      document.dispatchEvent(new CustomEvent('data:changed'));
      const runsRes = await api('/discovery/runs');
      el.querySelector('[data-runs]').innerHTML = runsHtml(runsRes.runs);
    } catch (err) {
      resultEl.innerHTML = `<div class="warn error">${icon('alert')}<span>${esc(err.message)}</span></div>`;
      toast(err.message, 'error');
    } finally {
      setButtonBusy(button, false);
    }
  }

  el.querySelectorAll('[data-run]').forEach((button) => {
    button.addEventListener('click', () => run(button.dataset.run, button));
  });
}

function runsHtml(runs) {
  if (!runs.length) return '<p class="tiny muted">No discovery runs yet. Start with a guided search or bulk paste.</p>';
  return `<table class="runs-table">
    <thead><tr><th>Source</th><th>Query</th><th>Status</th><th>Found</th><th>Added</th><th>When</th></tr></thead>
    <tbody>
      ${runs.map((run) => `<tr>
        <td>${esc(PROVIDER_LABELS[run.provider] || run.provider)}</td>
        <td class="truncate">${esc(run.query || '—')}</td>
        <td class="${run.status === 'done' ? 'ok' : run.status === 'error' ? 'err' : ''}">${esc(run.status)}</td>
        <td>${run.found}</td>
        <td>${run.added}</td>
        <td>${esc(relTime(run.finished_at || run.created_at))}</td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}
