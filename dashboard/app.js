/* ============================================================
   Dashboard — App Logic (pure KV, no GitHub API)
   ============================================================ */

// ─── Config ───────────────────────────────────────────────────

const CONFIG_KEY = 'tg-copilot-dashboard-config';

const DEFAULTS = {
  apiUrl: 'https://telegram-copilot-relay.yazelinj303.workers.dev',
  chatId: '850654509',
};

function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const cfg = JSON.parse(raw);
      if (cfg.apiUrl && cfg.chatId) return cfg;
    }
  } catch {}
  return { ...DEFAULTS };
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ─── Utils ────────────────────────────────────────────────────

function timeAgo(dateString) {
  if (!dateString) return '';
  const diff = Math.max(0, Date.now() - new Date(dateString).getTime());
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  const w = Math.floor(d / 7);
  const mo = Math.floor(d / 30);
  if (s < 60)   return 'just now';
  if (m < 60)   return `${m}m ago`;
  if (h < 24)   return `${h}h ago`;
  if (d < 7)    return `${d}d ago`;
  if (w < 5)    return `${w}w ago`;
  return `${mo}mo ago`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = String(str ?? '');
  return d.innerHTML;
}

function formatTime(dateString) {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return ''; }
}

// ─── Toast ────────────────────────────────────────────────────

const TOAST_ICONS = {
  info:    'information-outline',
  success: 'check-circle-outline',
  error:   'alert-circle-outline',
};

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.innerHTML = `<i class="mdi mdi-${TOAST_ICONS[type] || 'information-outline'}" aria-hidden="true"></i><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 4000);
}

// ─── Fetch ────────────────────────────────────────────────────

async function fetchStats(apiUrl) {
  const res = await fetch(`${apiUrl}/api/stats`);
  if (!res.ok) throw new Error(`Stats: ${res.status}`);
  return res.json();
}

async function fetchHistory(apiUrl, chatId) {
  const res = await fetch(`${apiUrl}/api/history/${chatId}`);
  if (!res.ok) throw new Error(`History: ${res.status}`);
  return res.json();
}

async function fetchRepos(apiUrl) {
  const res = await fetch(`${apiUrl}/api/repos`);
  if (!res.ok) throw new Error(`Repos: ${res.status}`);
  return res.json();
}

// ─── Render: Stats ────────────────────────────────────────────

function renderStats(stats) {
  ['totalMessages', 'totalApps', 'totalDraws', 'totalBuilds'].forEach(key => {
    const el = document.querySelector(`.stat-num[data-key="${key}"]`);
    if (el) {
      el.textContent = (stats[key] ?? 0).toLocaleString();
      el.classList.remove('skeleton-text');
    }
  });
}

function renderStatsError() {
  document.querySelectorAll('.stat-num').forEach(el => {
    el.textContent = '—';
    el.classList.remove('skeleton-text');
  });
}

// ─── Render: Repos ────────────────────────────────────────────

const BADGE_META = {
  created: { icon: 'plus-circle-outline', label: 'created' },
  build:   { icon: 'hammer-wrench',        label: 'build'   },
  msg:     { icon: 'message-text-outline', label: 'msg'     },
};

function renderRepos(reposData) {
  const container = document.getElementById('repos-container');
  const entries = reposData && typeof reposData === 'object' ? Object.entries(reposData) : [];

  if (entries.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="mdi mdi-source-repository" aria-hidden="true"></i></div>
        <div class="empty-msg">No repositories tracked yet</div>
        <div class="empty-sub">Use /app, /build, or /msg to track repos</div>
      </div>`;
    return;
  }

  // Sort by lastActivity descending
  entries.sort((a, b) =>
    new Date(b[1].lastActivity || 0).getTime() - new Date(a[1].lastActivity || 0).getTime()
  );

  container.innerHTML = entries.map(([name, meta], idx) => {
    const owner = meta.owner || 'aw-apps';
    const repoUrl    = `https://github.com/${owner}/${name}`;
    const actionsUrl = `https://github.com/${owner}/${name}/actions`;
    const pagesUrl   = meta.hasPages ? `https://${owner}.github.io/${name}/` : null;

    const desc = meta.description || meta.command || '';
    const iTotal = meta.issueTotal ?? 0;
    const iClosed = meta.issueClosed ?? 0;
    const pct = iTotal > 0 ? Math.round((iClosed / iTotal) * 100) : 100;
    const progressLabel = iTotal > 0 ? `${iClosed}/${iTotal} closed` : 'No issues';
    const lastActText = timeAgo(meta.lastActivity);

    const interactions = Array.isArray(meta.interactions) ? meta.interactions.slice(-3) : [];
    const badgesHtml = interactions.map(i => {
      const rawType = (i.type || '').toLowerCase();
      const t = ['created', 'build', 'msg'].includes(rawType) ? rawType : 'unknown';
      const m = BADGE_META[t] || { icon: 'circle-small', label: rawType };
      return `<span class="badge badge--${t}"><i class="mdi mdi-${escapeHtml(m.icon)}" aria-hidden="true"></i>${escapeHtml(m.label)}</span>`;
    }).join('');

    const progressWidth = iTotal > 0 ? pct : 0;

    return `
      <div class="repo-card" style="animation:rise .38s cubic-bezier(.16,1,.3,1) ${(idx * 45)}ms both">
        <a class="repo-name" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">
          <i class="mdi mdi-source-repository" aria-hidden="true"></i>${escapeHtml(name)}
        </a>
        ${desc ? `<div class="repo-desc">${escapeHtml(desc)}</div>` : '<div class="repo-desc" style="color:var(--text-3)">No description</div>'}
        <div class="progress-wrap">
          <div class="progress-outer">
            <div class="progress-inner" data-target="${progressWidth}" style="width:0%"></div>
          </div>
          <div class="progress-lbl">
            <span>${escapeHtml(progressLabel)}</span>
            ${iTotal > 0 ? `<span>${pct}%</span>` : ''}
          </div>
        </div>
        <div class="repo-foot">
          ${lastActText ? `<span class="repo-activity"><i class="mdi mdi-clock-outline" aria-hidden="true"></i>${escapeHtml(lastActText)}</span>` : ''}
          <div class="badges">${badgesHtml}</div>
        </div>
        <div class="repo-links">
          <a class="repo-link" href="${escapeHtml(repoUrl)}" target="_blank" rel="noopener noreferrer">
            <i class="mdi mdi-github" aria-hidden="true"></i>Repo
          </a>
          <a class="repo-link" href="${escapeHtml(actionsUrl)}" target="_blank" rel="noopener noreferrer">
            <i class="mdi mdi-play-circle-outline" aria-hidden="true"></i>Actions
          </a>
          ${pagesUrl ? `<a class="repo-link repo-link--pages" href="${escapeHtml(pagesUrl)}" target="_blank" rel="noopener noreferrer">
            <i class="mdi mdi-web" aria-hidden="true"></i>Site
          </a>` : ''}
        </div>
      </div>`;
  }).join('');

  // Animate progress bars after DOM renders
  requestAnimationFrame(() => requestAnimationFrame(() => {
    container.querySelectorAll('.progress-inner[data-target]').forEach(bar => {
      bar.style.width = `${bar.dataset.target}%`;
    });
  }));
}

function renderReposError() {
  document.getElementById('repos-container').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon"><i class="mdi mdi-alert-outline" aria-hidden="true"></i></div>
      <div class="empty-msg">Could not load repositories</div>
      <div class="empty-sub">Check your Worker API URL in settings</div>
    </div>`;
}

// ─── Render: Chat ─────────────────────────────────────────────

function renderChat(history) {
  const container = document.getElementById('chat-messages');

  if (!history || !Array.isArray(history) || history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"><i class="mdi mdi-message-text-outline" aria-hidden="true"></i></div>
        <div class="empty-msg">No messages yet</div>
        <div class="empty-sub">Bot conversations will appear here</div>
      </div>`;
    return;
  }

  container.innerHTML = history.map(msg => {
    const isUser = msg.role === 'user' || msg.from === 'user';
    const text = msg.text || msg.content || '';
    const isCommand = text.startsWith('/');
    const rowCls = isUser ? 'bubble-row--user' : 'bubble-row--bot';
    const bubbleCls = isUser ? 'bubble--user' : 'bubble--bot';
    const cmdCls = isCommand ? ' bubble--command' : '';
    const time = msg.timestamp || msg.date || msg.created_at || '';
    return `
      <div class="bubble-row ${rowCls}">
        <div>
          <div class="bubble ${bubbleCls}${cmdCls}">${escapeHtml(text)}</div>
          ${time ? `<div class="bubble-time">${formatTime(time)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  requestAnimationFrame(() => { container.scrollTop = container.scrollHeight; });
}

function renderChatError() {
  document.getElementById('chat-messages').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon"><i class="mdi mdi-alert-outline" aria-hidden="true"></i></div>
      <div class="empty-msg">Could not load chat history</div>
      <div class="empty-sub">Check your Worker API URL and Chat ID</div>
    </div>`;
}

// ─── Refresh ──────────────────────────────────────────────────

let isRefreshing = false;

async function refresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  const refreshIcon = document.querySelector('.icon-refresh');
  if (refreshIcon) refreshIcon.classList.add('spinning');
  try {
    const config = getConfig();
    const [stats, history, repos] = await Promise.all([
      fetchStats(config.apiUrl).catch(err => {
        console.error('Stats fetch failed:', err);
        toast('Worker offline — could not fetch stats', 'error');
        return null;
      }),
      fetchHistory(config.apiUrl, config.chatId).catch(err => {
        console.error('History fetch failed:', err);
        toast('Could not fetch chat history', 'error');
        return null;
      }),
      fetchRepos(config.apiUrl).catch(err => {
        console.error('Repos fetch failed:', err);
        toast('Could not fetch repositories', 'error');
        return null;
      }),
    ]);
    if (stats)   renderStats(stats);   else renderStatsError();
    if (repos)   renderRepos(repos);   else renderReposError();
    if (history) renderChat(history);  else renderChatError();
  } finally {
    isRefreshing = false;
    if (refreshIcon) refreshIcon.classList.remove('spinning');
  }
}

// ─── Settings ─────────────────────────────────────────────────

function openSettings() {
  const config = getConfig();
  document.getElementById('input-api-url').value = config.apiUrl || '';
  document.getElementById('input-chat-id').value = config.chatId || '';
  document.getElementById('settings-panel').classList.add('open');
  document.getElementById('settings-panel').setAttribute('aria-hidden', 'false');
  document.getElementById('settings-overlay').classList.add('open');
  // Move focus into panel for keyboard accessibility
  const firstInput = document.getElementById('input-api-url');
  if (firstInput) setTimeout(() => firstInput.focus(), 50);
}

function closeSettings() {
  document.getElementById('settings-panel').classList.remove('open');
  document.getElementById('settings-panel').setAttribute('aria-hidden', 'true');
  document.getElementById('settings-overlay').classList.remove('open');
  const settingsBtn = document.getElementById('btn-settings');
  if (settingsBtn) settingsBtn.focus();
}

function handleSaveSettings() {
  const apiUrl = document.getElementById('input-api-url').value.trim().replace(/\/+$/, '');
  const chatId = document.getElementById('input-chat-id').value.trim();
  if (!apiUrl || !chatId) {
    toast('Please fill in all fields', 'error');
    return;
  }
  if (!/^\d+$/.test(chatId)) {
    toast('Chat ID must be numeric', 'error');
    return;
  }
  saveConfig({ apiUrl, chatId });
  closeSettings();
  toast('Settings saved', 'success');
  refresh();
}

// ─── Init ─────────────────────────────────────────────────────

function init() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-panel').classList.contains('open') ? closeSettings() : openSettings();
  });

  document.getElementById('btn-refresh').addEventListener('click', refresh);
  document.getElementById('btn-save-settings').addEventListener('click', handleSaveSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);
  document.getElementById('btn-close-settings').addEventListener('click', closeSettings);
  document.getElementById('settings-overlay').addEventListener('click', closeSettings);

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSettings(); });

  refresh();
}

document.addEventListener('DOMContentLoaded', init);
