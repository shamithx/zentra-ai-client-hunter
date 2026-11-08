import { api } from '../api.js';
import {
  confirmDialog, emptyState, esc, fmtDate, icon, initials, openModal, platformMeta,
  priorityBadge, relTime, safeUrl, scheduleLabel, setButtonBusy, setPageActions, toast,
} from '../ui.js';
import { bindMessageCard, messageCardHtml } from '../message-ui.js';

function targetLead(row) {
  return {
    name: row.lead_name,
    platform: row.platform,
    profile_url: row.profile_url,
    priority: row.priority,
    category: row.category,
  };
}

function followupHead(row) {
  const profile = safeUrl(row.profile_url);
  return `<div class="followup-head">
    <div class="avatar avatar-ghost">${esc(initials(row.lead_name))}</div>
    <div class="grow">
      <strong>${esc(row.lead_name)}</strong>
      <div class="meta">
        <span>${esc(platformMeta(row.platform).label)}</span>
        <i class="meta-sep"></i>
        <span>${esc(row.category || 'Uncategorised')}</span>
        ${priorityBadge(row.priority || 'low')}
        <span class="badge ${row.lead_status === 'contacted' ? 'contacted' : 'new'}">${esc((row.lead_status || '').replaceAll('_', ' '))}</span>
      </div>
    </div>
    ${profile ? `<a class="icon-btn" href="${esc(profile)}" target="_blank" rel="noopener" title="Open profile">${icon('external')}</a>` : ''}
  </div>`;
}

function draftSlot(row, draftMessages) {
  if (!draftMessages.length) return '';
  const latest = draftMessages[0];
  return `<div class="followup-draft" data-draft-for="${row.id}">
    ${draftMessages.map((message) => messageCardHtml(message, targetLead(row), { showLead: false })).join('')}
  </div>`;
}

export async function renderFollowups(el, ctx) {
  setPageActions(`<a class="btn btn-ghost" href="#/settings?section=outreach">${icon('sliders')} Follow-up timing</a>`);
  el.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Checking the follow-up queue…</span></div>`;

  let data;
  let messages = [];
  try {
    [data, messages] = await Promise.all([
      api('/followups'),
      api('/messages?kind=followup&status=draft,approved&include_checks=1').then((res) => res.items),
    ]);
  } catch (err) {
    el.innerHTML = emptyState({
      iconName: 'alert',
      title: 'Could not load follow-ups',
      text: err.message,
      actions: '<button class="btn" data-retry>Try again</button>',
    });
    el.querySelector('[data-retry]').addEventListener('click', () => renderFollowups(el, ctx));
    return;
  }

  const draftsByLead = new Map();
  for (const message of messages) {
    if (!draftsByLead.has(message.lead_id)) draftsByLead.set(message.lead_id, []);
    draftsByLead.get(message.lead_id).push(message);
  }

  const due = data.due || [];
  const upcoming = data.upcoming || [];
  const history = data.history || [];

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Conversations</p>
        <h2>Follow-ups</h2>
        <p>A short, friendly nudge a few days after your first message. Every follow-up is drafted for your review — nothing is sent without you.</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-ghost" href="#/approvals">${icon('check-circle')} Approval queue</a>
        <a class="btn" href="#/leads?followups=due">${icon('users')} Leads due</a>
      </div>
    </div>

    <div class="stat-grid stat-grid-3">
      <div class="stat accent">
        <div class="stat-top"><span class="stat-label">Due now</span><span class="stat-icon">${icon('clock')}</span></div>
        <div class="stat-value">${due.length}</div>
        <div class="stat-hint">Ready for a personal nudge</div>
      </div>
      <div class="stat">
        <div class="stat-top"><span class="stat-label">Scheduled</span><span class="stat-icon">${icon('mail')}</span></div>
        <div class="stat-value">${upcoming.length}</div>
        <div class="stat-hint">Coming up automatically</div>
      </div>
      <div class="stat">
        <div class="stat-top"><span class="stat-label">Closed</span><span class="stat-icon">${icon('check')}</span></div>
        <div class="stat-value">${history.length}</div>
        <div class="stat-hint">Skipped, sent or finished</div>
      </div>
    </div>

    <div class="notice mb-18">
      ${icon('shield')}
      <div><strong>Follow-up, not pressure.</strong> Two follow-ups is the maximum. Once someone responds or converts, the queue stops. Draft, approve and send each one yourself.</div>
    </div>

    <div class="stack">
      <section>
        <div class="section-head">
          <h3>Due now</h3>
          <span class="tiny muted">${due.length ? `${due.length} waiting` : 'All clear'}</span>
        </div>
        <div class="followup-list" data-due>
          ${due.length ? due.map((row) => followupCard(row, draftsByLead.get(row.lead_id) || [])).join('') : ''}
        </div>
        ${due.length ? '' : `<div class="empty empty-flush"><div class="empty-icon">${icon('check-circle')}</div><h3>Nothing due right now</h3><p>After a first message is marked sent, ZENTRA schedules the next nudge so you never have to remember.</p><a class="btn" href="#/leads">Open leads</a></div>`}
      </section>

      ${upcoming.length ? `<section>
        <div class="section-head"><h3>Upcoming</h3><span class="tiny muted">${upcoming.length} scheduled</span></div>
        <div class="followup-list" data-upcoming>
          ${upcoming.map((row) => followupCard(row, draftsByLead.get(row.lead_id) || [], { upcoming: true })).join('')}
        </div>
      </section>` : ''}

      ${history.length ? `<section>
        <div class="section-head"><h3>Recently closed</h3><span class="tiny muted">Last ${history.length}</span></div>
        <div class="card card-flush">
          <table class="runs-table">
            <thead><tr><th>Prospect</th><th>Was due</th><th>Status</th></tr></thead>
            <tbody>
              ${history.map((row) => `<tr>
                <td>${esc(row.lead_name)}</td>
                <td>${esc(fmtDate(row.due_at, { time: true }))}</td>
                <td><span class="badge ${row.status === 'done' ? 'approved' : 'low'}">${esc(row.status)}</span></td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </section>` : ''}
    </div>`;

  el.querySelectorAll('.followup-card').forEach((card) => {
    const id = Number(card.dataset.followupId);
    const row = [...due, ...upcoming].find((item) => item.id === id);
    if (!row) return;

    card.querySelector('[data-generate]')?.addEventListener('click', () => openGenerateModal(row, () => renderFollowups(el, ctx)));
    card.querySelector('[data-skip]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Skip this follow-up?',
        message: `No follow-up will be sent to ${row.lead_name}. You can still follow up manually later.`,
        confirmLabel: 'Skip follow-up',
      });
      if (!ok) return;
      try {
        await api(`/followups/${row.id}/skip`, { method: 'POST', body: {} });
        toast('Follow-up skipped');
        document.dispatchEvent(new CustomEvent('data:changed'));
        renderFollowups(el, ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    card.querySelector('[data-done]')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'Mark as done?',
        message: 'Use this if you followed up outside the app. The next reminder will be scheduled according to your settings.',
        confirmLabel: 'Mark done',
      });
      if (!ok) return;
      try {
        await api(`/followups/${row.id}/done`, { method: 'POST', body: {} });
        toast('Follow-up closed');
        document.dispatchEvent(new CustomEvent('data:changed'));
        renderFollowups(el, ctx);
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    card.querySelectorAll('.message-card').forEach((messageCard) => {
      const messageId = Number(messageCard.dataset.messageId);
      const message = (draftsByLead.get(row.lead_id) || []).find((item) => item.id === messageId);
      if (!message) return;
      bindMessageCard(messageCard, message, targetLead(row), () => {
        document.dispatchEvent(new CustomEvent('data:changed'));
        renderFollowups(el, ctx);
      });
    });
  });
}

function followupCard(row, draftMessages, { upcoming = false } = {}) {
  const dueLabel = scheduleLabel(row.due_at);
  const overdue = new Date(row.due_at).getTime() < Date.now();
  return `<article class="followup-card ${upcoming ? 'upcoming' : ''}" data-followup-id="${row.id}">
    ${followupHead(row)}
    <div class="followup-meta">
      <span class="badge ${overdue ? 'medium' : 'new'}">${upcoming ? 'Scheduled' : overdue ? 'Due' : 'Soon'}</span>
      <span class="tiny dim">${esc(dueLabel)}</span>
      <i class="meta-sep"></i>
      <span class="tiny muted">${row.followups_sent || 0}/2 follow-ups sent</span>
      ${row.last_contact_at ? `<i class="meta-sep"></i><span class="tiny muted">First contact ${esc(relTime(row.last_contact_at))}</span>` : ''}
    </div>
    ${draftSlot(row, draftMessages)}
    <div class="msg-actions">
      <button class="btn btn-sm btn-violet" data-generate>${icon('sparkles')} ${draftMessages.length ? 'Regenerate draft' : 'Draft follow-up'}</button>
      <span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" data-done>Mark done</button>
      <button class="btn btn-sm btn-ghost" data-skip>Skip</button>
    </div>
  </article>`;
}

function openGenerateModal(row, onDone) {
  const modal = openModal({
    title: `Draft a follow-up for ${row.lead_name}`,
    subtitle: 'Short, warm and specific. No guilt, no pitch-slapping.',
    body: `
      <div class="form-grid">
        <div class="field"><label for="fu-tone">Tone</label>
          <select class="select" id="fu-tone">
            <option value="friendly">Friendly</option>
            <option value="direct">Direct</option>
            <option value="professional">Professional</option>
          </select>
        </div>
        <div class="field span-2"><label for="fu-observation">Anything to reference? <span class="muted">(optional)</span></label>
          <input class="input" id="fu-observation" maxlength="200" placeholder="e.g. the new menu launch you posted" />
          <span class="hint">A real detail beats a generic reminder every time.</span>
        </div>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn btn-primary" data-submit>${icon('sparkles')} Draft follow-up</button>`,
  });

  modal.el.querySelector('[data-cancel]').addEventListener('click', modal.close);
  const submit = modal.el.querySelector('[data-submit]');
  submit.addEventListener('click', async () => {
    setButtonBusy(submit, true, 'Writing');
    try {
      const result = await api(`/followups/${row.id}/generate`, {
        method: 'POST',
        body: {
          tone: modal.el.querySelector('#fu-tone').value,
          observation: modal.el.querySelector('#fu-observation').value,
        },
      });
      modal.close();
      toast(result.warning || 'Follow-up draft ready for review', result.warning ? 'warn' : 'success');
      document.dispatchEvent(new CustomEvent('data:changed'));
      onDone();
    } catch (err) {
      toast(err.message, 'error');
      setButtonBusy(submit, false);
    }
  });
}
