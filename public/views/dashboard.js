import { api } from '../api.js';
import {
  applySizes, esc, fmtDate, icon, relTime, setPageActions, timeGreeting, toast,
} from '../ui.js';

const ACTIVITY_ICONS = {
  lead_added: ['users', 'accent'],
  lead_analyzed: ['sparkles', 'violet'],
  message_drafted: ['mail', 'violet'],
  message_approved: ['check-circle', 'accent'],
  message_sent: ['external', 'accent'],
  followup_sent: ['external', 'accent'],
  followup_drafted: ['mail', 'violet'],
  followup_skipped: ['clock', ''],
  followup_done: ['check-circle', 'accent'],
  status_changed: ['refresh', ''],
  discovery_run: ['radar', 'accent'],
  import_completed: ['download', 'violet'],
  settings_updated: ['sliders', ''],
  demo_seeded: ['sparkles', 'violet'],
  demo_removed: ['trash', ''],
  lead_deleted: ['trash', ''],
  lead_enriched: ['sparkles', 'violet'],
  approval_reset: ['refresh', ''],
  message_rejected: ['close', ''],
};

function statCard({ label, value, hint, iconName, variant = '' }) {
  return `<div class="stat ${variant}">
    <div class="stat-top">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-icon">${icon(iconName)}</span>
    </div>
    <div class="stat-value">${esc(value)}</div>
    <div class="stat-hint">${esc(hint)}</div>
  </div>`;
}

function funnelRow(label, count, total) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `<div class="funnel-row">
    <span class="funnel-label">${esc(label)}</span>
    <span class="funnel-bar"><i data-w="${total > 0 ? Math.max(count > 0 ? 2 : 0, (count / total) * 100) : 0}"></i></span>
    <span class="funnel-value">${count}<small>${pct}% of discovered</small></span>
  </div>`;
}

function integrationRow(name, glyph, ready, detail) {
  return `<div class="integration">
    <span class="integration-icon">${icon(glyph)}</span>
    <div class="integration-text">
      <strong>${esc(name)}</strong>
      <span>${esc(detail)}</span>
    </div>
    <span class="status-pill ${ready ? 'on' : 'off'}"><span class="dot"></span>${ready ? 'Ready' : 'Optional'}</span>
  </div>`;
}

function activityRow(item) {
  const [glyph, variant] = ACTIVITY_ICONS[item.type] || ['refresh', ''];
  return `<div class="activity-item">
    <span class="activity-dot ${variant}">${icon(glyph)}</span>
    <div class="activity-body">
      <p>${esc(item.detail || item.type.replaceAll('_', ' '))}</p>
      <span>${esc(relTime(item.created_at))}</span>
    </div>
  </div>`;
}

export async function renderDashboard(el, ctx) {
  el.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>Loading your pipeline…</span></div>`;
  setPageActions('');

  let stats;
  try {
    stats = await api('/stats');
  } catch (err) {
    el.innerHTML = `<div class="empty"><h3>Could not load dashboard</h3><p>${esc(err.message)}</p></div>`;
    return;
  }

  const owner = stats.brand?.owner || 'there';
  const total = stats.total_leads;
  const notRejected = stats.funnel.discovered;
  const replyRate = stats.contacted > 0 ? Math.round((stats.responses / stats.contacted) * 100) : 0;
  const highShare = notRejected > 0 ? Math.round((stats.high_quality / notRejected) * 100) : 0;
  const convRate = stats.contacted > 0 ? Math.round((stats.converted / stats.contacted) * 100) : 0;
  const quota = stats.quota;
  const integrations = stats.integrations;

  const maxTrend = Math.max(1, ...stats.trend.map((day) => day.count));
  const trendBars = stats.trend.map((day) => `
    <div class="trend-day" title="${esc(fmtDate(day.day))}: ${day.count} lead${day.count === 1 ? '' : 's'}">
      <div class="trend-bar" data-h="${day.count > 0 ? Math.max(6, (day.count / maxTrend) * 100) : 1}"><span>${day.count}</span></div>
    </div>`).join('');

  const duePreview = stats.followups_due > 0 ? `<a class="btn btn-sm btn-ghost" href="#/followups">Review ${stats.followups_due}</a>` : '';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <p class="eyebrow">Overview · ${esc(fmtDate(new Date().toISOString()))}</p>
        <h2>${esc(timeGreeting())}, ${esc(owner)}</h2>
        <p>${total === 0
          ? 'Your pipeline is empty. Start with a guided search or paste public profile links you already found.'
          : `${notRejected} active prospect${notRejected === 1 ? '' : 's'} in the pipeline, ${stats.pending_messages} draft${stats.pending_messages === 1 ? '' : 's'} waiting for your approval.`}</p>
      </div>
      <div class="page-actions">
        <a class="btn" href="#/approvals">${icon('check-circle')} Approvals${stats.pending_messages ? ` · ${stats.pending_messages}` : ''}</a>
        <a class="btn btn-primary" href="#/discovery">${icon('radar')} Discover leads</a>
      </div>
    </div>

    ${total === 0 ? `
      <div class="card mb-18">
        <div class="empty empty-flush">
          <div class="empty-icon">${icon('sparkles')}</div>
          <h3>Start with data you can trust</h3>
          <p>Load eight labelled sample leads to explore scoring, drafting and approval — or jump straight into public-source discovery. Sample records are fictional and clearly marked.</p>
          <div class="row">
            <button class="btn btn-primary" data-action="seed">${icon('plus')} Load sample leads</button>
            <a class="btn" href="#/discovery">Open discovery</a>
            <a class="btn btn-ghost" href="#/settings?section=ai">Configure AI</a>
          </div>
        </div>
      </div>` : ''}

    <div class="stat-grid">
      ${statCard({ label: 'Total leads', value: total, hint: `${stats.new_leads} still unreviewed`, iconName: 'users' })}
      ${statCard({ label: 'High-quality', value: stats.high_quality, hint: `${highShare}% of the active pipeline`, iconName: 'sparkles', variant: 'accent' })}
      ${statCard({ label: 'Pending messages', value: stats.pending_messages, hint: `${stats.approved_messages} already approved`, iconName: 'mail', variant: 'violet' })}
      ${statCard({ label: 'Approved messages', value: stats.approved_messages, hint: 'Ready for you to send', iconName: 'check-circle' })}
      ${statCard({ label: 'Contacted', value: stats.contacted, hint: `${stats.messages_sent} messages sent in total`, iconName: 'external' })}
      ${statCard({ label: 'Responses', value: stats.responses, hint: `${replyRate}% reply rate`, iconName: 'mail' })}
      ${statCard({ label: 'Converted', value: stats.converted, hint: `${convRate}% of contacted leads`, iconName: 'check' })}
      ${statCard({ label: 'Average fit score', value: stats.avg_score, hint: 'Across non-rejected leads', iconName: 'radar' })}
    </div>

    <div class="dash-grid">
      <div class="dash-col">
        <div class="card">
          <div class="panel-head">
            <div><h3>Pipeline</h3><p>From discovery to a signed project</p></div>
            <a class="link" href="#/leads">View leads ${icon('arrow-right')}</a>
          </div>
          <div class="funnel">
            ${funnelRow('Discovered', stats.funnel.discovered, stats.funnel.discovered || 1)}
            ${funnelRow('High quality', stats.funnel.high_quality, stats.funnel.discovered || 1)}
            ${funnelRow('Contacted', stats.funnel.contacted, stats.funnel.discovered || 1)}
            ${funnelRow('Responded', stats.funnel.responded, stats.funnel.discovered || 1)}
            ${funnelRow('Converted', stats.funnel.converted, stats.funnel.discovered || 1)}
          </div>
        </div>

        <div class="card">
          <div class="panel-head">
            <div><h3>Lead flow</h3><p>New prospects added over the last 14 days</p></div>
            <span class="tiny muted">${stats.trend.reduce((sum, day) => sum + day.count, 0)} in 14 days</span>
          </div>
          <div class="trend">${trendBars}</div>
          <div class="trend-axis"><span>${esc(fmtDate(stats.trend[0]?.day))}</span><span>Today</span></div>
        </div>

        <div class="card">
          <div class="panel-head">
            <div><h3>Recent activity</h3><p>Everything the workspace has done</p></div>
          </div>
          <div class="activity">
            ${stats.activity.length ? stats.activity.map(activityRow).join('') : '<p class="tiny muted">No activity yet. Import a lead or run a discovery search.</p>'}
          </div>
        </div>
      </div>

      <div class="dash-col">
        <div class="card">
          <div class="panel-head">
            <div><h3>Outreach safety</h3><p>Manual sends, with hard limits</p></div>
            <span class="badge ${quota.canSendNow ? 'approved' : 'medium'}">${quota.canSendNow ? 'Ready' : 'Cooldown'}</span>
          </div>
          <div class="row-between">
            <div><div class="stat-value stat-value-sm">${quota.used}<span class="stat-unit"> / ${quota.max}</span></div><div class="stat-hint">messages marked sent today</div></div>
            <span class="tiny muted">${quota.minSeconds}s gap</span>
          </div>
          <div class="meter meter-lg"><i data-w="${(quota.used / quota.max) * 100}"></i></div>
          <p class="tiny muted">${quota.nextAllowedAt ? `Next send allowed ${relTime(quota.nextAllowedAt)}.` : 'No cooldown active.'} Nothing is ever sent automatically — you copy the message and send it yourself.</p>
          <a class="link mt-14" href="#/settings?section=outreach">Adjust outreach limits ${icon('arrow-right')}</a>
        </div>

        <div class="card">
          <div class="panel-head">
            <div><h3>Follow-ups</h3><p>${stats.followups_due} due now</p></div>
            ${duePreview}
          </div>
          ${stats.followups_due > 0
            ? `<p class="tiny dim">Follow-ups are drafted for your review and never sent automatically. Keep them personal and low-pressure.</p>`
            : `<p class="tiny muted">No follow-ups are due. After a first send, ZENTRA schedules one in a few days so nothing slips.</p>`}
          <a class="link mt-14" href="#/followups">Open follow-up queue ${icon('arrow-right')}</a>
        </div>

        <div class="card">
          <div class="panel-head">
            <div><h3>Connections</h3><p>Optional integrations</p></div>
            <a class="link" href="#/settings?section=integrations">Configure</a>
          </div>
          ${integrationRow('AI assistant', 'sparkles', integrations.ai.ready, integrations.ai.ready ? `${integrations.ai.provider} · ${integrations.ai.model}` : 'Heuristic scoring is active')}
          ${integrationRow('Google Search', 'search', integrations.google.ready, integrations.google.ready ? 'Programmable Search connected' : 'Guided search always available')}
          ${integrationRow('Meta / Instagram', 'instagram', integrations.meta.ready, integrations.meta.ready ? 'Graph API connected' : 'Bulk paste always available')}
          <p class="tiny muted mt-12">Without keys, discovery still works through guided searches and public URL imports. See Settings for exactly what each integration unlocks.</p>
        </div>

        <div class="card">
          <div class="panel-head"><div><h3>Quick actions</h3><p>Keep the pipeline moving</p></div></div>
          <div class="quick-actions">
            <a class="quick-action" href="#/discovery">
              <span class="integration-icon">${icon('radar')}</span>
              <div class="grow"><strong>Find new prospects</strong><span>Guided, Google or Instagram hashtags</span></div>
              ${icon('arrow-right')}
            </a>
            <a class="quick-action" href="#/leads">
              <span class="integration-icon">${icon('users')}</span>
              <div class="grow"><strong>Triage leads</strong><span>Score, filter and export</span></div>
              ${icon('arrow-right')}
            </a>
            <a class="quick-action" href="#/approvals">
              <span class="integration-icon">${icon('mail')}</span>
              <div class="grow"><strong>Approve drafts</strong><span>${stats.pending_messages} waiting for review</span></div>
              ${icon('arrow-right')}
            </a>
          </div>
        </div>
      </div>
    </div>`;

  applySizes(el);

  el.querySelector('[data-action="seed"]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const res = await api('/settings/demo-data', { method: 'POST', body: {} });
      toast(`${res.added} sample leads loaded`);
      document.dispatchEvent(new CustomEvent('data:changed'));
      renderDashboard(el, ctx);
    } catch (err) {
      toast(err.message, 'error');
      button.disabled = false;
    }
  });
}
