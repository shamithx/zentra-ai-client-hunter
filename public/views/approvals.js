import { api } from '../api.js';
import {
  debounce, emptyState, esc, icon, setPageActions,
} from '../ui.js';
import { bindMessageCard, messageCardHtml } from '../message-ui.js';

function summaryCard(label, value, hint, variant = '') {
  return `<div class="stat ${variant}">
    <div class="stat-top"><span class="stat-label">${esc(label)}</span></div>
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-hint">${esc(hint)}</div>
  </div>`;
}

export async function renderApprovals(el, ctx) {
  setPageActions(`<a class="btn btn-ghost" href="#/leads?has_draft=true">${icon('users')} Leads with drafts</a>`);

  el.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Loading the approval queue…</span></div>`;

  let data;
  try {
    data = await api('/messages?status=draft,approved&include_checks=1');
  } catch (err) {
    el.innerHTML = emptyState({
      iconName: 'alert',
      title: 'Could not load the approval queue',
      text: err.message,
      actions: '<button class="btn" data-retry>Try again</button>',
    });
    el.querySelector('[data-retry]').addEventListener('click', () => renderApprovals(el, ctx));
    return;
  }

  const items = data.items || [];
  const quota = data.quota || {};
  const state = { filter: 'all', q: '' };

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Human in the loop</p>
        <h2>Approvals</h2>
        <p>Review every draft before it leaves the app. You copy the message and send it from your own account — ZENTRA never messages anyone on your behalf.</p>
      </div>
    </div>

    <div class="stat-grid stat-grid-3">
      ${summaryCard('Waiting for review', items.filter((m) => m.status === 'draft').length, 'Drafts and follow-ups', 'violet')}
      ${summaryCard('Approved & ready', items.filter((m) => m.status === 'approved').length, 'Copy, send, then confirm', 'accent')}
      ${summaryCard('Sends left today', Math.max(0, (quota.max || 20) - (quota.used || 0)), `${quota.used || 0} of ${quota.max || 20} used · ${quota.minSeconds || 90}s gap`, '')}
    </div>

    <div class="notice mb-18">
      ${icon('shield')}
      <div><strong>Nothing sends automatically.</strong> Editing an approved message resets its approval, so what you send is always what you last reviewed. Daily limits and the minimum gap between sends are enforced by the server, not just the interface.</div>
    </div>

    <div class="toolbar">
      <label class="search">
        ${icon('search')}
        <input class="input" type="search" placeholder="Search prospect, country or message…" data-q aria-label="Search messages" />
      </label>
      <div class="chip-row" data-filters>
        <button class="chip active" data-filter="all">All <span data-count="all">${items.length}</span></button>
        <button class="chip" data-filter="draft">Drafts <span data-count="draft">${items.filter((m) => m.status === 'draft').length}</span></button>
        <button class="chip" data-filter="approved">Approved <span data-count="approved">${items.filter((m) => m.status === 'approved').length}</span></button>
      </div>
    </div>

    <div class="approval-list" data-list></div>`;

  const list = el.querySelector('[data-list]');
  const searchInput = el.querySelector('[data-q]');

  function visibleItems() {
    const term = state.q.toLowerCase();
    return items.filter((message) => {
      if (state.filter !== 'all' && message.status !== state.filter) return false;
      if (!term) return true;
      return [message.lead_name, message.country, message.category, message.body]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
  }

  function renderList() {
    const visible = visibleItems();
    if (!visible.length) {
      const hasItems = items.length > 0;
      list.innerHTML = emptyState({
        iconName: state.filter === 'approved' ? 'check-circle' : 'mail',
        title: hasItems ? 'Nothing matches this view' : 'No messages waiting',
        text: hasItems
          ? 'Try a different filter or clear the search.'
          : 'Generate a draft from any lead, then come back here to review and approve it.',
        actions: hasItems
          ? '<button class="btn" data-clear>Clear filters</button>'
          : '<a class="btn btn-primary" href="#/leads">Open leads</a><a class="btn" href="#/discovery">Find prospects</a>',
      });
      list.querySelector('[data-clear]')?.addEventListener('click', () => {
        state.q = '';
        state.filter = 'all';
        searchInput.value = '';
        el.querySelectorAll('[data-filter]').forEach((chip) => chip.classList.toggle('active', chip.dataset.filter === 'all'));
        renderList();
      });
      return;
    }

    list.innerHTML = visible.map((message) => messageCardHtml(message, message, { showLead: true })).join('');

    list.querySelectorAll('.message-card').forEach((card) => {
      const id = Number(card.dataset.messageId);
      const message = items.find((item) => item.id === id);
      const lead = {
        name: message.lead_name,
        profile_url: message.profile_url,
        platform: message.platform,
        priority: message.priority,
        category: message.category,
        country: message.country,
      };
      bindMessageCard(card, message, lead, () => renderApprovals(el, ctx));
    });
  }

  searchInput.addEventListener('input', debounce(() => {
    state.q = searchInput.value.trim();
    renderList();
  }, 220));

  el.querySelectorAll('[data-filter]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.filter = chip.dataset.filter;
      el.querySelectorAll('[data-filter]').forEach((other) => other.classList.toggle('active', other === chip));
      renderList();
    });
  });

  renderList();
}
