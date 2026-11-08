import { api } from './api.js';
import {
  confirmDialog, copyText, esc, fmtDate, icon, initials, openModal, platformMeta,
  priorityBadge, relTime, safeUrl, setButtonBusy, statusBadge, toast, wordCount,
} from './ui.js';

function warningHtml(warnings = []) {
  if (!warnings.length) return '';
  return `<div class="warn-list">${warnings.slice(0, 5).map((warning) => `
    <div class="warn ${warning.level === 'error' ? 'error' : ''}">
      ${icon('alert')}<span>${esc(warning.text)}</span>
    </div>`).join('')}</div>`;
}

export function messageCardHtml(message, lead, { showLead = false } = {}) {
  const editable = ['draft', 'approved'].includes(message.status);
  const target = lead || {};
  const profile = safeUrl(target.profile_url);
  const kindLabel = message.kind === 'followup' ? 'Follow-up' : 'First message';

  return `<article class="message-card ${esc(message.status)}" data-message-id="${message.id}">
    ${showLead ? `<div class="message-head">
      <div class="avatar avatar-ghost">${esc(initials(target.lead_name || target.name))}</div>
      <div class="grow">
        <strong>${esc(target.lead_name || target.name || 'Prospect')}</strong>
        <div class="meta">
          <span>${esc(platformMeta(target.platform).label)}</span>
          <i class="meta-sep"></i>
          <span>${esc(target.category || 'Uncategorised')}</span>
          ${target.country ? `<i class="meta-sep"></i><span>${esc(target.country)}</span>` : ''}
          ${priorityBadge(target.priority || 'low')}
          ${statusBadge(message.status)}
        </div>
      </div>
      <div class="row">
        ${profile ? `<a class="icon-btn" href="${esc(profile)}" target="_blank" rel="noopener" title="Open profile">${icon('external')}</a>` : ''}
      </div>
    </div>` : `<div class="message-head">
      <div class="grow">
        <div class="meta mt-0">
          <strong class="msg-kind">${esc(kindLabel)}</strong>
          <i class="meta-sep"></i>
          <span>${esc(relTime(message.created_at))}</span>
          <i class="meta-sep"></i>
          <span>${message.created_by === 'ai' ? 'AI draft' : message.created_by === 'heuristic' ? 'Template draft' : 'Manual'}</span>
          ${message.tone ? `<i class="meta-sep"></i><span>${esc(message.tone)}</span>` : ''}
        </div>
      </div>
      ${statusBadge(message.status)}
    </div>`}

    ${warningHtml(message.warnings)}

    ${editable
      ? `<textarea class="input msg-edit" data-msg-body spellcheck="true" aria-label="Message text">${esc(message.body)}</textarea>`
      : `<div class="msg-text">${esc(message.body)}</div>`}

    <div class="msg-actions">
      <span class="char-count" data-count>${wordCount(message.body)} words</span>
      ${editable ? '<button class="btn btn-sm btn-ghost hidden" data-act="save">Save changes</button>' : ''}
      <span class="spacer"></span>
      <button class="btn btn-sm btn-ghost" data-act="copy">${icon('copy')} Copy</button>
      ${profile ? `<a class="btn btn-sm btn-ghost" href="${esc(profile)}" target="_blank" rel="noopener">${icon('external')} Profile</a>` : ''}
      ${message.status === 'draft' ? `
        <button class="btn btn-sm btn-danger" data-act="reject">Reject</button>
        <button class="btn btn-sm btn-primary" data-act="approve">${icon('check')} Approve</button>` : ''}
      ${message.status === 'approved' ? `
        <button class="btn btn-sm btn-danger" data-act="reject">Reject</button>
        <button class="btn btn-sm btn-primary" data-act="send">${icon('mail')} Mark as sent</button>` : ''}
    </div>
  </article>`;
}

export function bindMessageCard(card, message, lead, onChange) {
  const textarea = card.querySelector('[data-msg-body]');
  const saveBtn = card.querySelector('[data-act="save"]');
  const sendBtn = card.querySelector('[data-act="send"]');
  const countEl = card.querySelector('[data-count]');
  let dirty = false;

  const currentBody = () => (textarea ? textarea.value.trim() : message.body);

  const markDirty = (value) => {
    dirty = textarea ? value !== message.body.trim() : false;
    if (saveBtn) saveBtn.classList.toggle('hidden', !dirty);
    if (sendBtn) {
      sendBtn.disabled = dirty;
      sendBtn.title = dirty ? 'Save your edits before marking as sent' : '';
    }
    if (countEl) countEl.textContent = `${wordCount(value)} words`;
  };

  if (textarea) {
    textarea.addEventListener('input', () => markDirty(textarea.value.trim()));
  }

  card.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const action = button.dataset.act;

    if (action === 'copy') {
      const ok = await copyText(currentBody());
      toast(ok ? 'Message copied' : 'Could not copy — select the text manually', ok ? 'success' : 'error');
      return;
    }

    if (action === 'save') {
      setButtonBusy(button, true, 'Saving');
      try {
        const res = await api(`/messages/${message.id}`, { method: 'PATCH', body: { body: currentBody() } });
        toast(res.approval_reset ? 'Saved — approval was reset after editing' : 'Draft saved', 'success');
        onChange();
      } catch (err) {
        toast(err.message, 'error');
        setButtonBusy(button, false);
      }
      return;
    }

    if (action === 'approve') {
      setButtonBusy(button, true, 'Approving');
      try {
        if (dirty) {
          await api(`/messages/${message.id}`, { method: 'PATCH', body: { body: currentBody() } });
        }
        await api(`/messages/${message.id}/approve`, { method: 'POST', body: {} });
        toast('Approved. Copy it and send it yourself when ready.', 'success');
        onChange();
      } catch (err) {
        toast(err.message + (err.details?.warnings?.[0]?.text ? ` — ${err.details.warnings[0].text}` : ''), 'error');
        onChange();
      }
      return;
    }

    if (action === 'reject') {
      const approved = await confirmDialog({
        title: 'Reject this message?',
        message: 'The draft stays in history but will not be sent. You can generate a new one afterwards.',
        confirmLabel: 'Reject message',
        danger: true,
      });
      if (!approved) return;
      try {
        await api(`/messages/${message.id}/reject`, { method: 'POST', body: {} });
        toast('Message rejected');
        onChange();
      } catch (err) {
        toast(err.message, 'error');
      }
      return;
    }

    if (action === 'send') {
      if (dirty) {
        toast('Save your edits first.', 'warn');
        return;
      }
      openSendDialog(message, lead, onChange);
    }
  });
}

export async function openSendDialog(message, lead, onChange) {
  const profile = safeUrl(lead?.profile_url);
  const post = safeUrl(message.kind === 'followup' ? '' : lead?.post_url);
  const targetUrl = profile || post;

  const modal = openModal({
    title: 'Mark as sent',
    subtitle: 'ZENTRA Hunter never sends automatically. Send it from your own account, then confirm here.',
    body: `
      <div class="steps">
        <div class="step"><b>1</b><span>Copy the message below.</span></div>
        <div class="step"><b>2</b><span>Open the profile and send it as a normal DM.</span></div>
        <div class="step"><b>3</b><span>Come back and confirm so the follow-up timer can start.</span></div>
      </div>
      <div class="msg-text" data-msg-preview>${esc(message.body)}</div>
      <div class="row-between mt-14">
        <span class="tiny muted" data-quota-line>Checking today’s outreach limit…</span>
        <a class="link" href="#/settings" data-close-settings>Adjust limits</a>
      </div>`,
    footer: `
      <button class="btn btn-ghost" data-cancel>Cancel</button>
      <button class="btn" data-copy-open>${icon('copy')} Copy &amp; open profile</button>
      <button class="btn btn-primary" data-confirm-send ${targetUrl ? '' : 'disabled'}>I’ve sent it</button>`,
  });

  modal.el.querySelectorAll('[data-cancel]').forEach((btn) => btn.addEventListener('click', () => modal.close()));
  modal.el.querySelector('[data-close-settings]')?.addEventListener('click', () => {
    modal.close();
    location.hash = '#/settings?section=outreach';
  });

  const quotaLine = modal.el.querySelector('[data-quota-line]');
  api('/stats').then((stats) => {
    const quota = stats.quota;
    quotaLine.textContent = `${quota.used} of ${quota.max} manual sends used today · ${quota.minSeconds}s minimum gap`;
    if (quota.nextAllowedAt) {
      quotaLine.textContent += ` · next send ${relTime(quota.nextAllowedAt)}`;
    }
  }).catch(() => {
    quotaLine.textContent = 'Daily limits apply to every send.';
  });

  modal.el.querySelector('[data-copy-open]').addEventListener('click', async () => {
    const ok = await copyText(message.body);
    if (targetUrl) window.open(targetUrl, '_blank', 'noopener');
    toast(ok ? 'Copied. Paste it into the DM and send.' : 'Could not copy — select the preview text manually', ok ? 'success' : 'warn');
  });

  const sendBtn = modal.el.querySelector('[data-confirm-send]');
  sendBtn.addEventListener('click', async () => {
    setButtonBusy(sendBtn, true, 'Recording');
    try {
      const result = await api(`/messages/${message.id}/send`, { method: 'POST', body: {} });
      const next = result.lead?.next_follow_up_at;
      toast(next ? `Marked as sent. Follow-up suggested for ${fmtDate(next, { time: true })}.` : 'Marked as sent.');
      modal.close();
      onChange();
      document.dispatchEvent(new CustomEvent('data:changed'));
    } catch (err) {
      toast(err.message + (err.details?.warnings?.[0]?.text ? ` — ${err.details.warnings[0].text}` : ''), 'error');
      setButtonBusy(sendBtn, false);
    }
  });
}
