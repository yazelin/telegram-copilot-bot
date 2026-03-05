/* ============================================================
   Telegram Copilot Bot — Dashboard Logic
   ============================================================ */

// ─── Config ──────────────────────────────────────────────────

const CONFIG_KEY = 'tg-copilot-dashboard-config';

function getConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const cfg = JSON.parse(raw);
    if (!cfg.apiUrl || !cfg.org || !cfg.chatId) return null;
    return cfg;
  } catch {
    return null;
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ─── Toast Notifications ─────────────────────────────────────

function toast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('removing');
    el.addEventListener('animationend', () => el.remove());
  }, 4000);
}

// ─── Fetching ────────────────────────────────────────────────

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

async function fetchRepoMeta(apiUrl) {
  const res = await fetch(`${apiUrl}/api/repos`);
  if (!res.ok) throw new Error(`Repos meta: ${res.status}`);
  return res.json();
}

async function fetchGitHubRepos(org) {
  const res = await fetch(`https://api.github.com/orgs/${org}/repos?sort=updated&per_page=30`);
  if (res.status === 403) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error(`GitHub repos: ${res.status}`);
  return res.json();
}

async function fetchRepoIssues(org, repo) {
  const res = await fetch(`https://api.github.com/repos/${org}/${repo}/issues?state=all&per_page=30`);
  if (res.status === 403) throw new Error('RATE_LIMIT');
  if (!res.ok) throw new Error(`GitHub issues: ${res.status}`);
  return res.json();
}

// ─── Utils ───────────────────────────────────────────────────

function timeAgo(dateString) {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diff = Math.max(0, now - then);
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24)   return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  if (days < 7)     return `${days} day${days !== 1 ? 's' : ''} ago`;
  if (weeks < 5)    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  return `${months} month${months !== 1 ? 's' : ''} ago`;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function formatTime(dateString) {
  try {
    const d = new Date(dateString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ─── Rendering: Stats ────────────────────────────────────────

function renderStats(stats) {
  const keys = ['totalMessages', 'totalApps', 'totalDraws', 'totalBuilds'];
  keys.forEach(key => {
    const el = document.querySelector(`.stat-value[data-key="${key}"]`);
    if (el) {
      const val = stats[key] ?? 0;
      el.textContent = val.toLocaleString();
      el.classList.remove('skeleton-text');
    }
  });
}

function renderStatsError() {
  document.querySelectorAll('.stat-value').forEach(el => {
    el.textContent = '—';
    el.classList.remove('skeleton-text');
  });
}

// ─── Rendering: Repos ────────────────────────────────────────

const issuesCache = {};

function renderRepos(ghRepos, kvMeta) {
  const container = document.getElementById('repos-container');

  if (!ghRepos || ghRepos.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📂</div>
        <div class="empty-msg">No repositories found</div>
        <div class="empty-sub">Check the GitHub org in settings</div>
      </div>`;
    return;
  }

  const metaMap = {};
  if (kvMeta && Array.isArray(kvMeta)) {
    kvMeta.forEach(m => { if (m.name) metaMap[m.name] = m; });
  } else if (kvMeta && typeof kvMeta === 'object') {
    Object.assign(metaMap, kvMeta);
  }

  container.innerHTML = ghRepos.map(repo => {
    const meta = metaMap[repo.name];
    const hasPages = repo.has_pages;
    const org = repo.owner?.login || '';
    const openIssues = repo.open_issues_count || 0;
    const pagesUrl = hasPages ? `https://${org}.github.io/${repo.name}/` : null;
    const createdVia = meta?.command || meta?.createdVia || null;

    return `
      <div class="repo-card" data-repo="${escapeHtml(repo.name)}" data-org="${escapeHtml(org)}">
        <a class="repo-name" href="${escapeHtml(repo.html_url)}" target="_blank" rel="noopener"
           onclick="event.stopPropagation()">${escapeHtml(repo.name)}</a>
        ${createdVia ? `<span class="repo-badge">✨ Created via: ${escapeHtml(createdVia)}</span>` : ''}
        <div class="repo-desc">${escapeHtml(repo.description || 'No description')}</div>
        <div class="repo-meta">
          <span>Updated ${timeAgo(repo.updated_at)}</span>
          ${repo.language ? `<span>· ${escapeHtml(repo.language)}</span>` : ''}
          <span>· ${openIssues} open issue${openIssues !== 1 ? 's' : ''}</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-bar-outer">
            <div class="progress-bar-inner" style="width:0%" id="prog-${escapeHtml(repo.name)}"></div>
          </div>
          <div class="progress-label">
            <span id="prog-label-${escapeHtml(repo.name)}">Loading issues...</span>
            <span id="prog-pct-${escapeHtml(repo.name)}"></span>
          </div>
        </div>
        <div class="repo-actions">
          ${pagesUrl ? `<a class="btn-pages" href="${escapeHtml(pagesUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">🌐 GitHub Pages</a>` : ''}
        </div>
        <div class="repo-issues">
          <ul class="issues-list" id="issues-${escapeHtml(repo.name)}"></ul>
        </div>
      </div>`;
  }).join('');

  // attach click handlers for expand
  container.querySelectorAll('.repo-card').forEach(card => {
    card.addEventListener('click', () => handleRepoClick(card));
  });

  // fetch issues for each repo in background (staggered to avoid rate limit)
  ghRepos.forEach((repo, i) => {
    setTimeout(() => loadIssuesForRepo(repo.owner?.login, repo.name), i * 200);
  });
}

async function loadIssuesForRepo(org, repoName) {
  if (!org || !repoName) return;
  try {
    const issues = await fetchRepoIssues(org, repoName);
    // filter out pull requests
    const realIssues = issues.filter(i => !i.pull_request);
    issuesCache[repoName] = realIssues;

    const closed = realIssues.filter(i => i.state === 'closed').length;
    const total = realIssues.length;
    const pct = total > 0 ? Math.round((closed / total) * 100) : 100;

    const bar = document.getElementById(`prog-${repoName}`);
    const label = document.getElementById(`prog-label-${repoName}`);
    const pctEl = document.getElementById(`prog-pct-${repoName}`);

    if (bar)   bar.style.width = `${pct}%`;
    if (label) label.textContent = `${closed} / ${total} closed`;
    if (pctEl) pctEl.textContent = `${pct}%`;
  } catch (err) {
    if (err.message === 'RATE_LIMIT') {
      const label = document.getElementById(`prog-label-${repoName}`);
      if (label) label.textContent = 'Rate limited';
    }
  }
}

function handleRepoClick(card) {
  const repoName = card.dataset.repo;
  const isExpanded = card.classList.toggle('expanded');

  if (isExpanded && issuesCache[repoName]) {
    const list = card.querySelector('.issues-list');
    const issues = issuesCache[repoName];

    if (issues.length === 0) {
      list.innerHTML = '<li class="issue-item" style="color:var(--text-muted)">No issues</li>';
    } else {
      list.innerHTML = issues.map(iss => `
        <li class="issue-item">
          <span class="issue-badge issue-badge--${iss.state === 'open' ? 'open' : 'closed'}"></span>
          <span class="issue-title">
            <a href="${escapeHtml(iss.html_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${escapeHtml(iss.title)}</a>
          </span>
        </li>`).join('');
    }
  }
}

// ─── Rendering: Chat ─────────────────────────────────────────

function renderChat(history) {
  const container = document.getElementById('chat-messages');

  if (!history || !Array.isArray(history) || history.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-msg">No messages yet</div>
        <div class="empty-sub">Messages from the Telegram bot will appear here</div>
      </div>`;
    return;
  }

  container.innerHTML = history.map(msg => {
    const isUser = msg.role === 'user' || msg.from === 'user';
    const text = msg.text || msg.content || '';
    const isCommand = text.startsWith('/');
    const rowClass = isUser ? 'bubble-row--user' : 'bubble-row--bot';
    const bubbleClass = isUser ? 'bubble--user' : 'bubble--bot';
    const cmdClass = isCommand ? ' bubble--command' : '';
    const time = msg.timestamp || msg.date || msg.created_at || '';

    return `
      <div class="bubble-row ${rowClass}">
        <div>
          <div class="bubble ${bubbleClass}${cmdClass}">${escapeHtml(text)}</div>
          ${time ? `<div class="bubble-time">${formatTime(time)}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  // scroll to bottom
  requestAnimationFrame(() => {
    container.scrollTop = container.scrollHeight;
  });
}

// ─── Main Refresh Logic ──────────────────────────────────────

let isRefreshing = false;

async function refresh() {
  if (isRefreshing) return;
  const config = getConfig();
  if (!config) {
    openSettings();
    toast('Please configure settings first', 'info');
    return;
  }

  isRefreshing = true;
  const refreshIcon = document.querySelector('.icon-refresh');
  if (refreshIcon) refreshIcon.classList.add('spinning');

  // Fetch worker API data in parallel
  const workerPromises = [
    fetchStats(config.apiUrl).catch(err => {
      console.error('Stats fetch failed:', err);
      toast('Worker offline — could not fetch stats. Check your API URL and try again.', 'error');
      return null;
    }),
    fetchHistory(config.apiUrl, config.chatId).catch(err => {
      console.error('History fetch failed:', err);
      toast('Worker offline — could not fetch chat history.', 'error');
      return null;
    }),
    fetchRepoMeta(config.apiUrl).catch(err => {
      console.error('Repo meta fetch failed:', err);
      return null;
    }),
  ];

  const ghPromise = fetchGitHubRepos(config.org).catch(err => {
    console.error('GitHub repos fetch failed:', err);
    if (err.message === 'RATE_LIMIT') {
      toast('GitHub API rate limit reached (60 req/hour). Try again later.', 'error');
    } else {
      toast(`Could not fetch GitHub repos: ${err.message}`, 'error');
    }
    return null;
  });

  const [stats, history, kvMeta, ghRepos] = await Promise.all([
    ...workerPromises,
    ghPromise,
  ]);

  // Render stats
  if (stats) {
    renderStats(stats);
  } else {
    renderStatsError();
  }

  // Render repos
  if (ghRepos) {
    renderRepos(ghRepos, kvMeta);
  } else {
    document.getElementById('repos-container').innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">⚠️</div>
        <div class="empty-msg">Could not load repositories</div>
        <div class="empty-sub">Check the GitHub org name or try again later</div>
      </div>`;
  }

  // Render chat
  if (history) {
    renderChat(history);
  } else {
    document.getElementById('chat-messages').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-msg">Could not load chat history</div>
        <div class="empty-sub">Check your Worker API URL and Chat ID</div>
      </div>`;
  }

  isRefreshing = false;
  if (refreshIcon) refreshIcon.classList.remove('spinning');
}

// ─── Settings Panel ──────────────────────────────────────────

function openSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');

  // populate fields from config
  const config = getConfig();
  if (config) {
    document.getElementById('input-api-url').value = config.apiUrl || '';
    document.getElementById('input-org').value = config.org || '';
    document.getElementById('input-chat-id').value = config.chatId || '';
  }
}

function closeSettings() {
  const panel = document.getElementById('settings-panel');
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}

function handleSaveSettings() {
  const apiUrl = document.getElementById('input-api-url').value.trim().replace(/\/+$/, '');
  const org = document.getElementById('input-org').value.trim();
  const chatId = document.getElementById('input-chat-id').value.trim();

  if (!apiUrl || !org || !chatId) {
    toast('Please fill in all fields', 'error');
    return;
  }

  saveConfig({ apiUrl, org, chatId });
  closeSettings();
  toast('Settings saved', 'success');
  refresh();
}

// ─── Init ────────────────────────────────────────────────────

function init() {
  // Settings toggle
  document.getElementById('btn-settings').addEventListener('click', () => {
    const panel = document.getElementById('settings-panel');
    if (panel.classList.contains('open')) {
      closeSettings();
    } else {
      openSettings();
    }
  });

  document.getElementById('btn-save-settings').addEventListener('click', handleSaveSettings);
  document.getElementById('btn-cancel-settings').addEventListener('click', closeSettings);

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', refresh);

  // If no config, auto-open settings
  const config = getConfig();
  if (!config) {
    openSettings();
  } else {
    refresh();
  }
}

// Kick off
document.addEventListener('DOMContentLoaded', init);
