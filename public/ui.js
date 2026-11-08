const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

export function safeUrl(value) {
  const str = String(value || '').trim();
  return /^https?:\/\//i.test(str) ? str : '';
}

export function icon(name, className = 'icon') {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

export function toast(message, type = 'success') {
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const glyph = type === 'error' ? 'alert' : type === 'warn' ? 'alert' : 'check-circle';
  el.innerHTML = `${icon(glyph)}<div>${esc(message)}</div>`;
  root.appendChild(el);
  while (root.children.length > 4) root.removeChild(root.firstElementChild);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    el.style.transition = 'opacity .25s, transform .25s';
    setTimeout(() => el.remove(), 260);
  }, type === 'error' ? 7000 : 4200);
}

export function fmtDate(iso, { time = false, year = false } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(year ? { year: 'numeric' } : {}),
    ...(time ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

export function relTime(iso) {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diff = then - Date.now();
  const abs = Math.abs(diff);
  const units = [
    [60_000, 'minute'],
    [3_600_000, 'hour'],
    [86_400_000, 'day'],
    [604_800_000, 'week'],
    [2_592_000_000, 'month'],
  ];
  if (abs < 60_000) return diff < 0 ? 'just now' : 'in a moment';
  let value = 1;
  let unit = 'minute';
  for (let i = 0; i < units.length; i += 1) {
    const [limit, name] = units[i];
    if (abs >= limit) {
      value = Math.floor(abs / limit);
      unit = name;
      if (i + 1 < units.length && abs >= units[i + 1][0]) continue;
      break;
    }
  }
  const label = `${value} ${unit}${value === 1 ? '' : 's'}`;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

export function scheduleLabel(iso) {
  if (!iso) return '—';
  return `${fmtDate(iso)} · ${relTime(iso)}`;
}

export function initials(name) {
  const clean = String(name || 'Z').replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  if (!clean) return 'Z';
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const PLATFORMS = {
  instagram: { label: 'Instagram', icon: 'instagram' },
  facebook: { label: 'Facebook', icon: 'facebook' },
  tiktok: { label: 'TikTok', icon: 'globe' },
  youtube: { label: 'YouTube', icon: 'globe' },
  linkedin: { label: 'LinkedIn', icon: 'globe' },
  other: { label: 'Other', icon: 'globe' },
};

export function platformMeta(platform) {
  return PLATFORMS[platform] || PLATFORMS.other;
}

export function platformMark(platform, size = '') {
  const meta = platformMeta(platform);
  return `<span class="platform-mark ${esc(platform || 'other')} ${size}" title="${esc(meta.label)}">${icon(meta.icon)}</span>`;
}

export function priorityBadge(priority) {
  return `<span class="badge ${esc(priority || 'low')}">${esc(priority || 'low')}</span>`;
}

export function statusBadge(status) {
  return `<span class="badge ${esc(status || 'new')}">${esc(String(status || 'new').replaceAll('_', ' '))}</span>`;
}

export function scoreCell(score, priority) {
  const value = Number(score) || 0;
  return `<div class="score-cell">
    <span class="score-num">${value}</span>
    <span class="score-bar ${esc(priority || 'low')}"><i data-w="${value}"></i></span>
  </div>`;
}

export function setPage(title, subtitle) {
  const titleEl = document.getElementById('page-title');
  const subEl = document.getElementById('page-subtitle');
  if (titleEl) titleEl.textContent = title;
  if (subEl) subEl.textContent = subtitle || '';
}

export function setPageActions(html) {
  const el = document.getElementById('topbar-actions');
  if (el) el.innerHTML = html;
}

export function applySizes(root = document) {
  root.querySelectorAll('[data-w]').forEach((el) => {
    const value = Math.max(0, Math.min(100, Number(el.getAttribute('data-w')) || 0));
    el.style.width = `${value}%`;
  });
  root.querySelectorAll('[data-h]').forEach((el) => {
    const value = Math.max(0, Math.min(100, Number(el.getAttribute('data-h')) || 0));
    el.style.height = `${value}%`;
  });
}

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function setButtonBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.original) btn.dataset.original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span>${label ? esc(label) : ''}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.original) {
      btn.innerHTML = btn.dataset.original;
      delete btn.dataset.original;
    }
  }
}

let activeModal = null;

export function closeModal() {
  if (!activeModal) return;
  const { wrap, onKey, onClose } = activeModal;
  activeModal = null;
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
  wrap.remove();
  if (onClose) onClose();
}

export function openModal({ title, subtitle = '', body = '', footer = '', wide = false, onMount, onClose }) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'modal-root';
  wrap.innerHTML = `
    <div class="modal-scrim"></div>
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <div class="grow"><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
        <button class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
      </div>
      <div class="modal-body">${body}</div>
      ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
    </div>`;
  document.getElementById('modal-root').appendChild(wrap);
  document.body.style.overflow = 'hidden';

  const onKey = (event) => {
    if (!activeModal) return;
    if (event.key === 'Escape') {
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = wrap.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', onKey);
  activeModal = { wrap, onKey, onClose };

  wrap.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', closeModal));
  wrap.querySelector('.modal-scrim').addEventListener('click', closeModal);

  const modalEl = wrap.querySelector('.modal');
  requestAnimationFrame(() => {
    const target = modalEl.querySelector('input:not([type=hidden]), textarea, select') || modalEl.querySelector('button');
    if (target) target.focus();
  });

  if (onMount) onMount(modalEl, closeModal);
  return { el: modalEl, close: closeModal };
}

export function confirmDialog({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      closeModal();
    };
    const modal = openModal({
      title,
      body: `<p class="confirm-text">${esc(message)}</p>`,
      footer: `
        <button class="btn btn-ghost" data-cancel>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${esc(confirmLabel)}</button>`,
      onClose: () => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      },
    });
    modal.el.querySelector('[data-cancel]').addEventListener('click', () => finish(false));
    modal.el.querySelector('[data-confirm]').addEventListener('click', () => finish(true));
  });
}

export function emptyState({ iconName = 'radar', title, text, actions = '' }) {
  return `<div class="empty">
    <div class="empty-icon">${icon(iconName)}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
    ${actions}
  </div>`;
}

export function timeGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

export function refreshSignal() {
  document.dispatchEvent(new CustomEvent('data:changed'));
}
