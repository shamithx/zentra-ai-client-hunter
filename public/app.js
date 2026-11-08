import { api, setCsrf } from './api.js';
import {
  closeModal, debounce, esc, icon, initials, setPage, setPageActions, toast,
} from './ui.js';
import { renderDashboard } from './views/dashboard.js';
import { renderLeads } from './views/leads.js';
import { renderDiscovery } from './views/discovery.js';
import { renderApprovals } from './views/approvals.js';
import { renderFollowups } from './views/followups.js';
import { renderSettings } from './views/settings.js';

const ROUTES = {
  dashboard: {
    title: 'Dashboard',
    subtitle: 'Your discovery pipeline at a glance',
    render: renderDashboard,
  },
  leads: {
    title: 'Leads',
    subtitle: 'Prospects, fit scores and conversation history',
    render: renderLeads,
  },
  discovery: {
    title: 'Discovery',
    subtitle: 'Public-source prospect search',
    render: renderDiscovery,
  },
  approvals: {
    title: 'Approvals',
    subtitle: 'Review every message before it sends',
    render: renderApprovals,
  },
  followups: {
    title: 'Follow-ups',
    subtitle: 'Personal nudges, drafted for your approval',
    render: renderFollowups,
  },
  settings: {
    title: 'Settings',
    subtitle: 'Brand, safety limits and integrations',
    render: renderSettings,
  },
};

const bootEl = document.getElementById('boot');
const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const authFormEl = document.getElementById('auth-form');
const viewEl = document.getElementById('view');
const sidebar = document.getElementById('sidebar');
const scrim = document.getElementById('scrim');

let csrf = null;
let chromeTimer = null;

function show(el, visible) {
  el.hidden = false;
  el.classList.toggle('hidden', !visible);
}

function hideBoot() {
  bootEl.classList.add('hidden');
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/dashboard';
  const [pathPart, queryPart = ''] = raw.split('?');
  const name = pathPart.replace(/^\//, '').replace(/\/$/, '') || 'dashboard';
  return { name: ROUTES[name] ? name : 'dashboard', query: new URLSearchParams(queryPart) };
}

function setNav(route) {
  document.querySelectorAll('.nav a').forEach((link) => {
    link.classList.toggle('active', link.dataset.route === route);
  });
}

async function route() {
  const { name, query } = parseRoute();
  const meta = ROUTES[name];

  if (!location.hash) {
    history.replaceState(null, '', '#/dashboard');
  }

  closeModal();
  document.querySelectorAll('.drawer').forEach((drawer) => drawer.remove());
  document.body.style.overflow = '';

  setNav(name);
  setPage(meta.title, meta.subtitle);
  setPageActions('');
  viewEl.scrollTop = 0;
  window.scrollTo({ top: 0, behavior: 'auto' });

  try {
    await meta.render(viewEl, { query });
  } catch (err) {
    viewEl.innerHTML = `<div class="empty">
      <div class="empty-icon">${icon('alert')}</div>
      <h3>This view failed to load</h3>
      <p>${esc(err.message)}</p>
      <button class="btn" data-retry>Reload this view</button>
    </div>`;
    viewEl.querySelector('[data-retry]').addEventListener('click', route);
  }
}

async function refreshChrome() {
  if (!csrf) return;
  try {
    const stats = await api('/stats');
    const owner = stats.brand?.owner || stats.brand?.name || 'ZENTRA Creates';
    const ownerEl = document.getElementById('side-owner');
    const avatarEl = document.getElementById('side-avatar');
    if (ownerEl) ownerEl.textContent = owner;
    if (avatarEl) avatarEl.textContent = initials(owner);

    const quota = stats.quota || { used: 0, max: 20, minSeconds: 90, remaining: 20 };
    const label = document.getElementById('quota-label');
    const meter = document.getElementById('quota-meter');
    const note = document.getElementById('quota-note');
    if (label) label.textContent = `${quota.used} / ${quota.max}`;
    if (meter) meter.style.width = `${Math.min(100, (quota.used / Math.max(1, quota.max)) * 100)}%`;
    if (note) note.textContent = quota.nextAllowedAt ? `Next send ${new Date(quota.nextAllowedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : `${quota.remaining} manual sends left today`;

    const approvalsBadge = document.getElementById('badge-approvals');
    const followupsBadge = document.getElementById('badge-followups');
    if (approvalsBadge) {
      approvalsBadge.textContent = stats.pending_messages;
      approvalsBadge.hidden = !stats.pending_messages;
    }
    if (followupsBadge) {
      followupsBadge.textContent = stats.followups_due;
      followupsBadge.hidden = !stats.followups_due;
    }
  } catch {
    // Chrome is decorative; the active view surfaces real errors.
  }
}

function scheduleChrome() {
  clearTimeout(chromeTimer);
  chromeTimer = setTimeout(refreshChrome, 220);
}

function closeSidebar() {
  sidebar.classList.remove('open');
  scrim.hidden = true;
}

async function startApp(data) {
  csrf = data.csrf || csrf;
  setCsrf(csrf);
  show(authEl, false);
  show(appEl, true);
  hideBoot();
  closeSidebar();
  await refreshChrome();
  await route();
}

function authError(message) {
  const existing = authFormEl.querySelector('.auth-error');
  if (existing) existing.remove();
  if (!message) return;
  const box = document.createElement('div');
  box.className = 'auth-error';
  box.textContent = message;
  authFormEl.prepend(box);
}

function showLogin() {
  csrf = null;
  setCsrf(null);
  closeModal();
  show(appEl, false);
  show(authEl, true);
  hideBoot();
  authFormEl.innerHTML = `
    <h2>Welcome back</h2>
    <p class="muted tiny">Sign in to continue to your pipeline.</p>
    <form data-auth-form>
      <div class="field">
        <label for="login-password">Dashboard password</label>
        <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required autofocus />
      </div>
      <button class="btn btn-primary" type="submit">Sign in</button>
    </form>
    <div class="auth-note">${icon('shield')}<div>Session protected with a CSRF token and an HttpOnly cookie. Login attempts are rate limited.</div></div>`;
  bindAuthForm('login');
}

function showSetup() {
  show(appEl, false);
  show(authEl, true);
  hideBoot();
  authFormEl.innerHTML = `
    <h2>Create your dashboard password</h2>
    <p class="muted tiny">One local account protects every lead, message and integration key.</p>
    <form data-auth-form>
      <div class="field">
        <label for="setup-password">Password</label>
        <input class="input" id="setup-password" name="password" type="password" autocomplete="new-password" minlength="10" required autofocus />
        <span class="hint">At least 10 characters with a letter and a number.</span>
      </div>
      <div class="field">
        <label for="setup-confirm">Confirm password</label>
        <input class="input" id="setup-confirm" name="confirm" type="password" autocomplete="new-password" minlength="10" required />
      </div>
      <button class="btn btn-primary" type="submit">Create password &amp; open</button>
    </form>
    <div class="auth-note">${icon('shield')}<div>Stored as a scrypt hash. There is no cloud account and no password reset email — keep it somewhere safe.</div></div>`;
  bindAuthForm('setup');
}

function bindAuthForm(mode) {
  const form = authFormEl.querySelector('[data-auth-form]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    authError('');
    const button = form.querySelector('button[type="submit"]');
    const formData = new FormData(form);
    const password = formData.get('password');
    if (mode === 'setup' && password !== formData.get('confirm')) {
      authError('Passwords do not match.');
      return;
    }
    button.disabled = true;
    button.textContent = mode === 'setup' ? 'Creating…' : 'Signing in…';
    try {
      const res = await api(mode === 'setup' ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: { password },
      });
      csrf = res.csrf;
      await startApp(res);
    } catch (err) {
      authError(err.message);
      button.disabled = false;
      button.textContent = mode === 'setup' ? 'Create password & open' : 'Sign in';
    }
  });
}

async function boot() {
  try {
    const me = await api('/auth/me');
    if (me.needsSetup) {
      showSetup();
      return;
    }
    if (me.authenticated) {
      await startApp(me);
      return;
    }
    showLogin();
  } catch (err) {
    hideBoot();
    show(authEl, true);
    authFormEl.innerHTML = `<h2>Cannot reach the server</h2><p class="muted tiny">${esc(err.message)}</p><div class="auth-note">${icon('alert')}<div>Make sure the Node server is running, then refresh this page.</div></div>`;
  }
}

window.addEventListener('hashchange', () => {
  if (csrf) route();
});

document.getElementById('menu-btn').addEventListener('click', () => {
  sidebar.classList.add('open');
  scrim.hidden = false;
});
scrim.addEventListener('click', closeSidebar);
sidebar.querySelectorAll('.nav a').forEach((link) => link.addEventListener('click', closeSidebar));

document.getElementById('logout-btn').addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST', body: {} });
  } catch {
    // Even if the request fails, drop local access.
  }
  showLogin();
  toast('Signed out');
});

document.addEventListener('data:changed', scheduleChrome);
document.addEventListener('auth:expired', () => {
  if (!csrf) return;
  showLogin();
  toast('Session expired — sign in again', 'warn');
});

boot();
