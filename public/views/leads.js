import { api, downloadUrl } from '../api.js';
import {
  applySizes, confirmDialog, debounce, emptyState, esc, fmtDate, icon, initials, openModal,
  platformMark, platformMeta, priorityBadge, relTime, safeUrl, scoreCell, setButtonBusy,
  setPageActions, statusBadge, toast,
} from '../ui.js';
import { bindMessageCard, messageCardHtml } from '../message-ui.js';

const STATUSES = ['new', 'reviewing', 'approved', 'contacted', 'responded', 'converted', 'rejected'];
const PRIORITIES = ['high', 'medium', 'low'];
const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'youtube', 'linkedin', 'other'];
const CATEGORIES = [
  'Food & Beverage', 'Real Estate', 'Fitness & Wellness', 'Beauty & Personal Care', 'E-commerce',
  'Creator', 'Travel & Hospitality', 'Health & Medical', 'Professional Services', 'Home Services',
  'Education & Coaching', 'Automotive', 'Pet Services', 'Events & Weddings', 'Small Business',
];
const PAGE_SIZE = 25;

function optionList(values, selected, allLabel) {
  return [
    `<option value="">${esc(allLabel)}</option>`,
    ...values.map((value) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(value.replaceAll('_', ' '))}</option>`),
  ].join('');
}

function leadQueryString(state) {
  const params = new URLSearchParams();
  for (const key of ['q', 'status', 'priority', 'platform', 'country', 'sort', 'dir']) {
    if (state[key]) params.set(key, state[key]);
  }
  if (state.page > 1) params.set('page', String(state.page));
  return params;
}

function updateHash(state) {
  const qs = leadQueryString(state).toString();
  history.replaceState(null, '', `#/leads${qs ? `?${qs}` : ''}`);
}

function searchText(lead) {
  if (lead.profile_url) {
    try {
      const url = new URL(lead.profile_url);
      const path = url.pathname.replace(/\//g, '');
      return path ? `@${path}` : url.hostname;
    } catch {
      return lead.profile_url;
    }
  }
  return lead.source === 'sample' ? 'Sample record' : 'No profile link';
}

function nextStep(lead) {
  if (lead.status === 'responded' || lead.status === 'converted' || lead.status === 'rejected') {
    return `<span class="tiny muted">${lead.status === 'converted' ? 'Client won' : lead.status === 'rejected' ? 'Closed' : 'In conversation'}</span>`;
  }
  if (lead.next_follow_up_at) return `<span class="tiny dim">Follow up ${esc(relTime(lead.next_follow_up_at))}</span>`;
  if (lead.draft_count) return '<span class="badge draft">Draft ready</span>';
  return `<span class="tiny muted">${lead.analysis_mode === 'ai' ? 'AI scored' : 'Not contacted'}</span>`;
}

export async function renderLeads(el, ctx) {
  setPageActions('');
  const query = ctx.query || new URLSearchParams();
  const state = {
    q: query.get('q') || '',
    status: query.get('status') || '',
    priority: query.get('priority') || '',
    platform: query.get('platform') || '',
    country: query.get('country') || '',
    sort: query.get('sort') || 'score',
    dir: query.get('dir') || 'desc',
    page: Math.max(1, Number(query.get('page')) || 1),
  };
  let lastFacets = { countries: [], categories: [] };

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Prospecting</p>
        <h2>Leads</h2>
        <p>Every prospect keeps its source, fit rationale and conversation history. Filter the noise out before you spend time on outreach.</p>
      </div>
      <div class="page-actions">
        <a class="btn" data-export href="#" download>${icon('download')} Export CSV</a>
        <button class="btn" data-action="import">${icon('download')} Import</button>
        <button class="btn btn-primary" data-action="add">${icon('plus')} Add lead</button>
      </div>
    </div>

    <div class="toolbar">
      <label class="search">
        ${icon('search')}
        <input class="input" type="search" placeholder="Search name, notes, country…" data-search value="${esc(state.q)}" aria-label="Search leads" />
      </label>
      <select class="select" data-filter="status" aria-label="Filter by status">${optionList(STATUSES, state.status, 'All statuses')}</select>
      <select class="select" data-filter="priority" aria-label="Filter by priority">${optionList(PRIORITIES, state.priority, 'All priorities')}</select>
      <select class="select" data-filter="platform" aria-label="Filter by platform">${optionList(PLATFORMS, state.platform, 'All platforms')}</select>
      <select class="select" data-filter="country" aria-label="Filter by country"><option value="">All countries</option></select>
      <select class="select" data-filter="sort" aria-label="Sort leads">
        <option value="score" ${state.sort === 'score' ? 'selected' : ''}>Sort: Fit score</option>
        <option value="created_at" ${state.sort === 'created_at' ? 'selected' : ''}>Sort: Newest</option>
        <option value="priority" ${state.sort === 'priority' ? 'selected' : ''}>Sort: Priority</option>
        <option value="name" ${state.sort === 'name' ? 'selected' : ''}>Sort: Name</option>
        <option value="next_follow_up_at" ${state.sort === 'next_follow_up_at' ? 'selected' : ''}>Sort: Follow-up</option>
      </select>
      <button class="icon-btn" data-action="reset" title="Reset filters" aria-label="Reset filters">${icon('refresh')}</button>
    </div>

    <p class="tiny muted leads-count" data-count>Loading pipeline…</p>
    <div id="leads-container"></div>`;

  const container = el.querySelector('#leads-container');
  const countEl = el.querySelector('[data-count]');
  const exportLink = el.querySelector('[data-export]');
  const searchInput = el.querySelector('[data-search]');

  function syncExport() {
    exportLink.href = downloadUrl(`/leads/export.csv?${leadQueryString(state).toString()}`);
  }

  function setFacets(facets) {
    lastFacets = facets || lastFacets;
    const select = el.querySelector('[data-filter="country"]');
    const countries = lastFacets.countries || [];
    select.innerHTML = [
      '<option value="">All countries</option>',
      ...countries.map((row) => `<option value="${esc(row.value)}" ${row.value === state.country ? 'selected' : ''}>${esc(row.value)} (${row.count})</option>`),
    ].join('');
  }

  async function load() {
    countEl.textContent = 'Loading leads…';
    const params = leadQueryString(state);
    params.set('pageSize', String(PAGE_SIZE));
    try {
      const data = await api(`/leads?${params.toString()}`);
      setFacets(data.facets);
      countEl.textContent = data.total === 0
        ? 'No leads match these filters'
        : `${data.total} lead${data.total === 1 ? '' : 's'} · showing ${(data.page - 1) * data.pageSize + 1}–${Math.min(data.page * data.pageSize, data.total)}`;
      syncExport();
      updateHash(state);
      renderTable(data);
    } catch (err) {
      countEl.textContent = 'Could not load leads';
      container.innerHTML = emptyState({
        iconName: 'alert',
        title: 'Could not load your leads',
        text: err.message,
        actions: '<button class="btn" data-action="retry">Try again</button>',
      });
      container.querySelector('[data-action="retry"]').addEventListener('click', load);
    }
  }

  function renderTable(data) {
    if (!data.items.length) {
      const hasFilters = state.q || state.status || state.priority || state.platform || state.country;
      container.innerHTML = emptyState({
        iconName: 'users',
        title: hasFilters ? 'No leads match these filters' : 'No leads yet',
        text: hasFilters
          ? 'Try clearing a filter or searching for a different term.'
          : 'Add a prospect manually, import a CSV, or run a guided discovery search to get started.',
        actions: hasFilters
          ? '<button class="btn" data-action="reset">Clear filters</button>'
          : '<button class="btn btn-primary" data-action="add">Add your first lead</button><a class="btn" href="#/discovery">Open discovery</a>',
      });
      container.querySelector('[data-action="reset"]')?.addEventListener('click', resetFilters);
      container.querySelector('[data-action="add"]')?.addEventListener('click', () => openLeadForm());
      return;
    }

    const sortArrow = (key) => {
      if (state.sort !== key) return '';
      return `<span class="tiny muted"> ${state.dir === 'asc' ? '↑' : '↓'}</span>`;
    };

    container.innerHTML = `
      <div class="table-wrap">
        <table class="leads">
          <thead><tr>
            <th class="sortable" data-sort="name">Prospect${sortArrow('name')}</th>
            <th>Category</th>
            <th class="sortable" data-sort="score">Fit${sortArrow('score')}</th>
            <th class="sortable" data-sort="priority">Priority${sortArrow('priority')}</th>
            <th class="sortable" data-sort="status">Status${sortArrow('status')}</th>
            <th class="sortable" data-sort="next_follow_up_at">Next step${sortArrow('next_follow_up_at')}</th>
            <th aria-label="Open"></th>
          </tr></thead>
          <tbody>
            ${data.items.map((lead) => `<tr data-lead-id="${lead.id}" tabindex="0">
              <td><div class="lead-cell">
                ${platformMark(lead.platform)}
                <div class="lead-cell-text"><strong>${esc(lead.name)}</strong><span>${esc(searchText(lead))}</span></div>
              </div></td>
              <td><span class="tiny dim">${esc(lead.category || 'Uncategorised')}</span><div class="tiny muted">${esc(lead.country || '—')}</div></td>
              <td>${scoreCell(lead.score, lead.priority)}</td>
              <td>${priorityBadge(lead.priority)}</td>
              <td>${statusBadge(lead.status)}</td>
              <td>${nextStep(lead)}</td>
              <td><span class="icon-btn" aria-hidden="true">${icon('arrow-right')}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="lead-cards">
        ${data.items.map((lead) => `<div class="lead-card" data-lead-id="${lead.id}" tabindex="0">
          <div class="lead-card-top">
            ${platformMark(lead.platform)}
            <div class="grow">
              <strong class="truncate lead-card-name">${esc(lead.name)}</strong>
              <span class="tiny muted truncate lead-card-handle">${esc(searchText(lead))}</span>
            </div>
            ${priorityBadge(lead.priority)}
          </div>
          <div class="lead-card-meta">
            ${statusBadge(lead.status)}
            <span class="tiny muted">${esc(lead.category || 'Uncategorised')}${lead.country ? ` · ${esc(lead.country)}` : ''}</span>
          </div>
          <div class="lead-card-foot">
            ${scoreCell(lead.score, lead.priority)}
            ${nextStep(lead)}
          </div>
        </div>`).join('')}
      </div>

      <div class="pagination">
        <span>${data.total} lead${data.total === 1 ? '' : 's'} · page ${data.page} of ${data.pages}</span>
        <div class="btns">
          <button class="btn btn-sm btn-ghost" data-page="prev" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
          <button class="btn btn-sm btn-ghost" data-page="next" ${data.page >= data.pages ? 'disabled' : ''}>Next</button>
        </div>
      </div>`;

    applySizes(container);
    container.querySelectorAll('[data-lead-id]').forEach((node) => {
      const id = Number(node.dataset.leadId);
      const open = () => openLeadDrawer(id, load);
      node.addEventListener('click', open);
      node.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
    container.querySelectorAll('[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
        else {
          state.sort = key;
          state.dir = key === 'name' ? 'asc' : 'desc';
        }
        state.page = 1;
        const sortSelect = el.querySelector('[data-filter="sort"]');
        if ([...sortSelect.options].some((option) => option.value === state.sort)) sortSelect.value = state.sort;
        load();
      });
    });
    container.querySelector('[data-page="prev"]')?.addEventListener('click', () => {
      state.page = Math.max(1, state.page - 1);
      load();
      el.scrollIntoView({ block: 'start' });
    });
    container.querySelector('[data-page="next"]')?.addEventListener('click', () => {
      state.page += 1;
      load();
      el.scrollIntoView({ block: 'start' });
    });
  }

  function resetFilters() {
    Object.assign(state, { q: '', status: '', priority: '', platform: '', country: '', sort: 'score', dir: 'desc', page: 1 });
    searchInput.value = '';
    el.querySelectorAll('[data-filter]').forEach((select) => { select.value = ''; });
    el.querySelector('[data-filter="sort"]').value = 'score';
    load();
  }

  searchInput.addEventListener('input', debounce(() => {
    state.q = searchInput.value.trim();
    state.page = 1;
    load();
  }, 320));

  el.querySelectorAll('[data-filter]').forEach((select) => {
    select.addEventListener('change', () => {
      const key = select.dataset.filter;
      if (key === 'sort') {
        state.sort = select.value;
        state.dir = select.value === 'name' ? 'asc' : 'desc';
      } else {
        state[key] = select.value;
      }
      state.page = 1;
      load();
    });
  });

  el.querySelector('[data-action="reset"]').addEventListener('click', resetFilters);
  el.querySelector('[data-action="add"]').addEventListener('click', () => openLeadForm(() => load()));
  el.querySelector('[data-action="import"]').addEventListener('click', () => openImportModal(() => load()));

  await load();
}

function openLeadForm(onDone) {
  const modal = openModal({
    title: 'Add a lead',
    subtitle: 'Only add people or businesses you found in public content. A profile URL keeps the record verifiable.',
    wide: true,
    body: `
      <form data-lead-form class="form-grid">
        <div class="field span-2"><label for="lf-name">Business or person name *</label><input class="input" id="lf-name" name="name" required maxlength="120" placeholder="e.g. Harbor & Hearth Cafe" /></div>
        <div class="field"><label for="lf-platform">Platform</label><select class="select" id="lf-platform" name="platform">${PLATFORMS.map((p) => `<option value="${p}">${platformMeta(p).label}</option>`).join('')}</select></div>
        <div class="field"><label for="lf-country">Country</label><input class="input" id="lf-country" name="country" maxlength="80" placeholder="e.g. United States" /></div>
        <div class="field span-2"><label for="lf-profile">Profile URL</label><input class="input" id="lf-profile" name="profile_url" maxlength="500" placeholder="https://www.instagram.com/username" /></div>
        <div class="field span-2"><label for="lf-post">Public post URL <span class="muted">(optional)</span></label><input class="input" id="lf-post" name="post_url" maxlength="500" placeholder="Link to the post that caught your attention" /></div>
        <div class="field"><label for="lf-category">Category</label><input class="input" id="lf-category" name="category" list="category-list" maxlength="80" placeholder="e.g. Real Estate" /></div>
        <div class="field"><label for="lf-followers">Followers</label><input class="input" id="lf-followers" name="followers" type="number" min="0" step="1" placeholder="e.g. 5000" /></div>
        <div class="field"><label for="lf-website">Website</label><input class="input" id="lf-website" name="website" maxlength="500" placeholder="https://" /></div>
        <div class="field"><label for="lf-email">Public email</label><input class="input" id="lf-email" name="email" type="email" maxlength="160" placeholder="hello@business.com" /></div>
        <div class="field span-2"><label for="lf-context">What you saw publicly</label><textarea class="input" id="lf-context" name="context" rows="3" maxlength="4000" placeholder="Paste the bio, caption or public description that shows why they might need video editing."></textarea><span class="hint">This text feeds the fit scoring. Facts only — no guesses.</span></div>
        <div class="field span-2"><label for="lf-notes">Your notes</label><textarea class="input" id="lf-notes" name="notes" rows="2" maxlength="4000" placeholder="Observation, angle, budget signals…"></textarea></div>
        <datalist id="category-list">${CATEGORIES.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
      </form>`,
    footer: `
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-submit>${icon('plus')} Add lead</button>`,
  });

  modal.el.querySelector('[data-cancel]').addEventListener('click', modal.close);
  const submit = modal.el.querySelector('[data-submit]');
  submit.addEventListener('click', async () => {
    const form = modal.el.querySelector('[data-lead-form]');
    if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form).entries());
    setButtonBusy(submit, true, 'Adding');
    try {
      const result = await api('/leads', { method: 'POST', body: payload });
      modal.close();
      toast(result.added ? 'Lead added to the pipeline' : 'That lead already exists — details merged');
      document.dispatchEvent(new CustomEvent('data:changed'));
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      setButtonBusy(submit, false);
    }
  });
}

function openImportModal(onDone) {
  const modal = openModal({
    title: 'Import leads from CSV',
    subtitle: 'Recognised headers: name, platform, profile_url, post_url, country, category, followers, website, email, notes, context. A URL-only list also works.',
    wide: true,
    body: `
      <div class="field">
        <label for="csv-file">Choose a CSV file</label>
        <input class="input" id="csv-file" type="file" accept=".csv,text/csv,text/plain" />
      </div>
      <div class="field mt-14">
        <label for="csv-text">Or paste CSV content</label>
        <textarea class="input" id="csv-text" rows="10" placeholder="name,platform,profile_url,country&#10;Harbor Cafe,instagram,https://instagram.com/harborcafe,United States"></textarea>
      </div>
      <p class="tiny muted mt-12">Duplicates are merged, and accounts that advertise editing services are filtered out automatically. Max 500 rows.</p>`,
    footer: `
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-submit>${icon('download')} Import leads</button>`,
  });

  const fileInput = modal.el.querySelector('#csv-file');
  const textarea = modal.el.querySelector('#csv-text');
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 4_000_000) {
      toast('That file is too large. Keep it under 4 MB.', 'error');
      return;
    }
    textarea.value = await file.text();
  });

  modal.el.querySelector('[data-cancel]').addEventListener('click', modal.close);
  const submit = modal.el.querySelector('[data-submit]');
  submit.addEventListener('click', async () => {
    if (!textarea.value.trim()) {
      toast('Choose a file or paste CSV content first', 'warn');
      return;
    }
    setButtonBusy(submit, true, 'Importing');
    try {
      const result = await api('/leads/import', { method: 'POST', body: { csv: textarea.value } });
      modal.close();
      toast(`${result.added} added · ${result.duplicates} duplicate${result.duplicates === 1 ? '' : 's'} · ${result.competitors} filtered`);
      document.dispatchEvent(new CustomEvent('data:changed'));
      onDone?.();
    } catch (err) {
      toast(err.message, 'error');
      setButtonBusy(submit, false);
    }
  });
}

function openLeadDrawer(id, onClose) {
  const wrap = document.createElement('div');
  wrap.className = 'drawer';
  wrap.innerHTML = `<div class="drawer-scrim"></div><aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="Lead details"></aside>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const panel = wrap.querySelector('.drawer-panel');
  let closed = false;
  let activeTab = 'overview';
  let detail = null;

  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    wrap.remove();
    document.body.style.overflow = '';
    onClose?.();
  };
  const onKey = (event) => {
    if (event.key === 'Escape' && !document.querySelector('.modal-root')) close();
  };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('.drawer-scrim').addEventListener('click', close);

  async function loadDrawer() {
    panel.innerHTML = `<div class="drawer-head"><div class="drawer-head-top"><div class="grow"><h2>Loading…</h2></div><button class="icon-btn" data-close aria-label="Close">${icon('close')}</button></div></div><div class="loading-block"><span class="spinner"></span><span>Loading prospect</span></div>`;
    panel.querySelector('[data-close]').addEventListener('click', close);
    try {
      const data = await api(`/leads/${id}`);
      detail = data;
      renderDrawer();
    } catch (err) {
      toast(err.message, 'error');
      close();
    }
  }

  async function loadMessages() {
    try {
      const data = await api(`/messages?lead_id=${id}&include_checks=1`);
      return data.items;
    } catch {
      return [];
    }
  }

  function renderDrawer() {
    const lead = detail.lead;
    const profile = safeUrl(lead.profile_url);
    const post = safeUrl(lead.post_url);
    const tabs = [
      ['overview', 'Overview'],
      ['messages', `Messages${detail.messages.length ? ` · ${detail.messages.length}` : ''}`],
      ['activity', 'Activity'],
    ];

    panel.innerHTML = `
      <div class="drawer-head">
        <div class="drawer-head-top">
          <div class="avatar">${esc(initials(lead.name))}</div>
          <div class="grow">
            <h2>${esc(lead.name)}</h2>
            <div class="sub">
              ${priorityBadge(lead.priority)}
              ${statusBadge(lead.status)}
              <span class="badge ${lead.analysis_mode === 'ai' ? 'ai' : 'heuristic'}">${lead.analysis_mode === 'ai' ? 'AI scored' : 'Heuristic'}</span>
              ${lead.source === 'sample' ? '<span class="badge sample">Sample</span>' : ''}
              <span class="tiny muted">${esc(platformMeta(lead.platform).label)}${lead.country ? ` · ${esc(lead.country)}` : ''}</span>
            </div>
          </div>
          <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
        </div>
        <div class="tabs">
          ${tabs.map(([key, label]) => `<button data-tab="${key}" class="${activeTab === key ? 'active' : ''}">${esc(label)}</button>`).join('')}
        </div>
      </div>
      <div class="drawer-body" data-body>${activeTab === 'overview' ? overviewHtml(lead, profile, post) : activeTab === 'activity' ? activityHtml() : '<div class="loading-block"><span class="spinner"></span></div>'}</div>`;

    panel.querySelector('[data-close]').addEventListener('click', close);
    panel.querySelectorAll('[data-tab]').forEach((tab) => {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.tab;
        renderDrawer();
      });
    });

    if (activeTab === 'overview') bindOverview(lead);
    if (activeTab === 'activity') bindActivity();
    if (activeTab === 'messages') renderMessagesTab(lead);
  }

  function overviewHtml(lead, profile, post) {
    return `
      <div class="why-box">
        <p class="eyebrow">Why this lead</p>
        <p>${esc(lead.why_fit || 'Run an analysis to generate a fit rationale.')}</p>
        ${lead.signals?.length ? `<div class="signal-list">${lead.signals.map((signal) => `
          <div class="signal ${esc(signal.kind || 'positive')}"><span>${esc(signal.label)}</span></div>`).join('')}</div>` : ''}
        ${lead.service_offer ? `<p class="tiny muted mt-12"><strong class="dim">Suggested pitch:</strong> ${esc(lead.service_offer)}</p>` : ''}
      </div>

      <div class="detail-grid">
        <div class="detail"><span>Fit score</span><strong>${lead.score}/100 · ${esc(lead.priority)}</strong></div>
        <div class="detail"><span>Followers</span><strong>${lead.followers ? Number(lead.followers).toLocaleString('en-US') : '—'}</strong></div>
        <div class="detail"><span>Source</span><strong>${esc(lead.source.replaceAll('_', ' '))}</strong></div>
        <div class="detail"><span>Last contacted</span><strong>${esc(lead.last_contact_at ? fmtDate(lead.last_contact_at) : 'Never')}</strong></div>
        <div class="detail"><span>Next follow-up</span><strong>${esc(lead.next_follow_up_at ? fmtDate(lead.next_follow_up_at) : 'None')}</strong></div>
        <div class="detail"><span>Analyzed</span><strong>${esc(lead.analyzed_at ? relTime(lead.analyzed_at) : 'Not yet')}</strong></div>
      </div>

      <div class="row wrap mb-18">
        ${profile ? `<a class="btn btn-sm" href="${esc(profile)}" target="_blank" rel="noopener">${icon('external')} Open profile</a>` : ''}
        ${post ? `<a class="btn btn-sm btn-ghost" href="${esc(post)}" target="_blank" rel="noopener">${icon('external')} Open post</a>` : ''}
        ${lead.website ? `<a class="btn btn-sm btn-ghost" href="${esc(safeUrl(lead.website))}" target="_blank" rel="noopener">${icon('globe')} Website</a>` : ''}
        ${lead.email ? `<a class="btn btn-sm btn-ghost" href="mailto:${esc(lead.email)}">${icon('mail')} ${esc(lead.email)}</a>` : ''}
      </div>

      <form data-lead-edit>
        <div class="form-grid">
          <div class="field span-2"><label for="d-name">Name</label><input class="input" id="d-name" name="name" value="${esc(lead.name)}" maxlength="120" required /></div>
          <div class="field"><label for="d-platform">Platform</label><select class="select" id="d-platform" name="platform">${PLATFORMS.map((p) => `<option value="${p}" ${lead.platform === p ? 'selected' : ''}>${platformMeta(p).label}</option>`).join('')}</select></div>
          <div class="field"><label for="d-status">Pipeline status</label><select class="select" id="d-status" name="status">${STATUSES.map((s) => `<option value="${s}" ${lead.status === s ? 'selected' : ''}>${s.replaceAll('_', ' ')}</option>`).join('')}</select></div>
          <div class="field"><label for="d-priority">Priority</label><select class="select" id="d-priority" name="priority">${PRIORITIES.map((p) => `<option value="${p}" ${lead.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
          <div class="field"><label for="d-country">Country</label><input class="input" id="d-country" name="country" value="${esc(lead.country || '')}" maxlength="80" /></div>
          <div class="field"><label for="d-category">Category</label><input class="input" id="d-category" name="category" value="${esc(lead.category || '')}" list="drawer-categories" maxlength="80" /></div>
          <div class="field"><label for="d-followers">Followers</label><input class="input" id="d-followers" name="followers" type="number" min="0" value="${lead.followers ?? ''}" /></div>
          <div class="field span-2"><label for="d-profile">Profile URL</label><input class="input" id="d-profile" name="profile_url" value="${esc(lead.profile_url || '')}" maxlength="500" /></div>
          <div class="field span-2"><label for="d-post">Post URL</label><input class="input" id="d-post" name="post_url" value="${esc(lead.post_url || '')}" maxlength="500" /></div>
          <div class="field"><label for="d-website">Website</label><input class="input" id="d-website" name="website" value="${esc(lead.website || '')}" maxlength="500" /></div>
          <div class="field"><label for="d-email">Email</label><input class="input" id="d-email" name="email" type="email" value="${esc(lead.email || '')}" maxlength="160" /></div>
          <div class="field span-2"><label for="d-service">Service to offer</label><input class="input" id="d-service" name="service_offer" value="${esc(lead.service_offer || '')}" maxlength="400" /></div>
          <div class="field span-2"><label for="d-why">Why they fit</label><textarea class="input" id="d-why" name="why_fit" rows="3" maxlength="1200">${esc(lead.why_fit || '')}</textarea></div>
          <div class="field span-2"><label for="d-context">Public context</label><textarea class="input" id="d-context" name="context" rows="3" maxlength="4000">${esc(lead.context || '')}</textarea></div>
          <div class="field span-2"><label for="d-notes">Your notes</label><textarea class="input" id="d-notes" name="notes" rows="2" maxlength="4000">${esc(lead.notes || '')}</textarea></div>
          <datalist id="drawer-categories">${CATEGORIES.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>
        </div>
        <div class="form-actions spread">
          <button type="button" class="btn btn-sm btn-violet" data-analyze>${icon('sparkles')} Re-analyze</button>
          <div class="row">
            ${lead.platform === 'instagram' ? `<button type="button" class="btn btn-sm" data-enrich>${icon('instagram')} Enrich from IG</button>` : ''}
            <button type="submit" class="btn btn-sm btn-primary" data-save>Save changes</button>
          </div>
        </div>
      </form>

      <div class="mt-14">
        <button class="btn btn-sm btn-danger" data-delete>${icon('trash')} Delete lead</button>
      </div>`;
  }

  function bindOverview(lead) {
    const body = panel.querySelector('[data-body]');
    body.querySelector('[data-delete]').addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Delete this lead?',
        message: `All messages and follow-ups for ${lead.name} will be removed. This cannot be undone.`,
        confirmLabel: 'Delete lead',
        danger: true,
      });
      if (!ok) return;
      try {
        await api(`/leads/${lead.id}`, { method: 'DELETE' });
        toast('Lead deleted');
        document.dispatchEvent(new CustomEvent('data:changed'));
        close();
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    body.querySelector('[data-analyze]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setButtonBusy(button, true, 'Analyzing');
      try {
        const result = await api(`/leads/${lead.id}/analyze`, { method: 'POST', body: {} });
        toast(result.warning || `Scored ${result.lead.score}/100`, result.warning ? 'warn' : 'success');
        document.dispatchEvent(new CustomEvent('data:changed'));
        await loadDrawer();
        activeTab = 'overview';
        renderDrawer();
      } catch (err) {
        toast(err.message, 'error');
        setButtonBusy(button, false);
      }
    });

    body.querySelector('[data-enrich]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      setButtonBusy(button, true, 'Enriching');
      try {
        await api(`/leads/${lead.id}/enrich`, { method: 'POST', body: {} });
        toast('Profile enriched from Instagram');
        await loadDrawer();
        activeTab = 'overview';
        renderDrawer();
      } catch (err) {
        toast(err.message, 'error');
        setButtonBusy(button, false);
      }
    });

    body.querySelector('[data-lead-edit]').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = Object.fromEntries(new FormData(form).entries());
      payload.followers = payload.followers === '' ? null : payload.followers;
      const save = body.querySelector('[data-save]');
      setButtonBusy(save, true, 'Saving');
      try {
        await api(`/leads/${lead.id}`, { method: 'PATCH', body: payload });
        toast('Lead updated');
        document.dispatchEvent(new CustomEvent('data:changed'));
        await loadDrawer();
        activeTab = 'overview';
        renderDrawer();
      } catch (err) {
        toast(err.message, 'error');
        setButtonBusy(save, false);
      }
    });
  }

  function activityHtml() {
    if (!detail.activity.length) return '<p class="tiny muted">No activity recorded for this lead yet.</p>';
    return `<div class="activity">${detail.activity.map((item) => `
      <div class="activity-item">
        <span class="activity-dot">${icon('refresh')}</span>
        <div class="activity-body"><p>${esc(item.detail || item.type)}</p><span>${esc(fmtDate(item.created_at, { time: true }))} · ${esc(relTime(item.created_at))}</span></div>
      </div>`).join('')}</div>`;
  }

  function bindActivity() {
    // Activity is read-only.
  }

  async function renderMessagesTab(lead) {
    const body = panel.querySelector('[data-body]');
    const messages = await loadMessages();
    if (activeTab !== 'messages') return;

    const initialSent = detail.messages.some((m) => m.kind === 'initial' && m.status === 'sent');
    const followUpsSent = detail.messages.filter((m) => m.kind === 'followup' && m.status === 'sent').length;
    const canGenerate = !initialSent || followUpsSent < 2;
    const generateLabel = initialSent ? 'Generate follow-up' : 'Generate first message';

    body.innerHTML = `
      <div class="why-box">
        <p class="eyebrow">Message studio</p>
        <p>${initialSent
          ? `First message sent ${detail.lead.last_contact_at ? relTime(detail.lead.last_contact_at) : 'recently'}. ${followUpsSent}/2 follow-ups used.`
          : 'Draft the first message, then approve it. Nothing leaves this app without your explicit approval.'}</p>
        ${canGenerate ? `<div class="form-grid mt-14">
          <div class="field"><label for="msg-tone">Tone</label><select class="select" id="msg-tone"><option value="friendly">Friendly</option><option value="direct">Direct</option><option value="professional">Professional</option></select></div>
          <div class="field"><label for="msg-observation">Your observation <span class="muted">(optional)</span></label><input class="input" id="msg-observation" maxlength="200" placeholder="e.g. your food shots are strong" /></div>
        </div>
        <div class="row mt-14">
          <button class="btn btn-violet btn-sm" data-generate>${icon('sparkles')} ${generateLabel}</button>
          <span class="tiny muted">Facts only. The observation is optional.</span>
        </div>` : `<p class="tiny muted mt-14">Two follow-ups have been sent. This lead should be left alone unless they reply.</p>`}
      </div>
      <div data-messages>
        ${messages.length
          ? messages.map((message) => messageCardHtml(message, lead)).join('')
          : '<p class="tiny muted">No messages yet. Generate a draft when you are ready.</p>'}
      </div>`;

    body.querySelectorAll('.message-card').forEach((card) => {
      const id = Number(card.dataset.messageId);
      const message = messages.find((item) => item.id === id);
      bindMessageCard(card, message, lead, async () => {
        await loadDrawer();
        activeTab = 'messages';
        renderDrawer();
      });
    });

    body.querySelector('[data-generate]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const tone = body.querySelector('#msg-tone').value;
      const observation = body.querySelector('#msg-observation').value;
      setButtonBusy(button, true, 'Writing');
      try {
        const result = await api(`/leads/${lead.id}/messages`, {
          method: 'POST',
          body: { kind: initialSent ? 'followup' : 'initial', tone, observation },
        });
        toast(result.warning || 'Draft ready — review it below', result.warning ? 'warn' : 'success');
        document.dispatchEvent(new CustomEvent('data:changed'));
        await loadDrawer();
        activeTab = 'messages';
        renderDrawer();
      } catch (err) {
        toast(err.message, 'error');
        setButtonBusy(button, false);
      }
    });
  }

  loadDrawer();
}
