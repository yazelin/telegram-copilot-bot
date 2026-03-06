# Dashboard v2 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign Dashboard to pure KV data (no GitHub API calls from browser), high-quality Stripe/Linear-inspired frontend, repo tracking for all bot interactions.

**Architecture:** Worker stores repo metadata (including issue counts) in KV whenever bot operates on a repo. Dashboard reads only from Worker API endpoints. No GitHub API calls from browser ever.

**Tech Stack:** Cloudflare Workers + KV, GitHub Actions bash scripts, Vanilla JS + CSS (Inter font, MDI icons), GitHub Pages

---

### Task 1: Expand `repo_created` callback + add `repo_activity` type in Worker

**Files:**
- Modify: `worker/src/index.js` — `handleCallback()` function (lines 248–274)

**What to do:**

In `handleCallback`, expand the `repo_created` handler to support `issueTotal` and `issueClosed` fields, and add a new `repo_activity` type for `/build` and `/msg` interactions.

Replace the existing `repo_created` block and add `repo_activity` block:

```javascript
if (type === "repo_created" && repo) {
  await env.BOT_MEMORY.put(`repo:${repo}`, JSON.stringify({
    createdAt: timestamp || new Date().toISOString(),
    command: command || "",
    chatId: chat_id || "",
    description: description || "",
    issueTotal: issueTotal ?? 0,
    issueClosed: issueClosed ?? 0,
    lastActivity: timestamp || new Date().toISOString(),
    interactions: [{ type: "created", timestamp: timestamp || new Date().toISOString() }],
  }));
}

if (type === "repo_activity" && repo) {
  const key = `repo:${repo}`;
  const existing = (await env.BOT_MEMORY.get(key, "json")) || {};
  const interactions = Array.isArray(existing.interactions) ? existing.interactions : [];
  interactions.push({ type: activityType || "unknown", timestamp: timestamp || new Date().toISOString() });
  await env.BOT_MEMORY.put(key, JSON.stringify({
    ...existing,
    lastActivity: timestamp || new Date().toISOString(),
    issueTotal: issueTotal ?? existing.issueTotal ?? 0,
    issueClosed: issueClosed ?? existing.issueClosed ?? 0,
    interactions: interactions.slice(-20),
  }));
}
```

Also destructure the new fields at the top of `handleCallback`:
```javascript
const { type, chat_id, text, timestamp, repo, command, description, prefs,
        issueTotal, issueClosed, activityType } = body;
```

**Deploy:**
```bash
cd worker && npm run deploy
```

**Commit:**
```bash
git add worker/src/index.js
git commit -m "feat: expand repo KV schema with issue counts and activity tracking"
```

---

### Task 2: Update `route_command.sh` — `/build` and `/msg` post repo_activity callback

**Files:**
- Modify: `.github/scripts/route_command.sh`

**What to do:**

Add a `post_repo_activity` helper function after `post_callback`:

```bash
post_repo_activity() {
  local repo="$1"
  local activity_type="$2"
  if [ -z "${CALLBACK_URL:-}" ] || [ -z "${CALLBACK_TOKEN:-}" ] || [ -z "$repo" ]; then
    return 0
  fi
  local payload
  payload=$(REPO="$repo" ATYPE="$activity_type" CHAT="$CHAT_ID" python3 -c "
import json, os
from datetime import datetime, timezone
print(json.dumps({
  'type': 'repo_activity',
  'repo': os.environ['REPO'],
  'activityType': os.environ['ATYPE'],
  'chat_id': os.environ['CHAT'],
  'timestamp': datetime.now(timezone.utc).isoformat(),
}))
")
  curl -s -X POST "$CALLBACK_URL" \
    -H "Content-Type: application/json" \
    -H "X-Secret: $CALLBACK_TOKEN" \
    -d "$payload" || true
}
```

Then add calls after the existing `/build` success message:
```bash
post_repo_activity "$REPO" "build"
```

And after the existing `/msg` success message:
```bash
post_repo_activity "$REPO" "msg"
```

**Commit:**
```bash
git add .github/scripts/route_command.sh
git commit -m "feat: track /build and /msg interactions in repo KV"
```

---

### Task 3: Fetch issue counts server-side when repo_created callback is triggered

**Files:**
- Modify: `worker/src/index.js` — `handleCallback()`, add a helper `fetchIssueCounts()`

**What to do:**

When a `repo_created` callback arrives, the Worker should fetch issue counts from GitHub (using `env.GITHUB_TOKEN`) and store them. Add helper:

```javascript
async function fetchIssueCounts(owner, repo, token) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`,
      { headers: { Authorization: `Bearer ${token}`, "User-Agent": "telegram-copilot-bot" } }
    );
    if (!res.ok) return { total: 0, closed: 0 };
    const issues = await res.json();
    const real = issues.filter(i => !i.pull_request);
    return { total: real.length, closed: real.filter(i => i.state === "closed").length };
  } catch {
    return { total: 0, closed: 0 };
  }
}
```

In the `repo_created` handler, call this if `issueTotal` is not already provided:
```javascript
let iTotal = issueTotal ?? 0;
let iClosed = issueClosed ?? 0;
if (!issueTotal && env.GITHUB_TOKEN && env.GITHUB_OWNER) {
  const counts = await fetchIssueCounts(env.GITHUB_OWNER, repo, env.GITHUB_TOKEN);
  iTotal = counts.total;
  iClosed = counts.closed;
}
```

Same for `repo_activity` when `activityType === "msg"` (since /msg implies issue interaction).

**Deploy:**
```bash
cd worker && npm run deploy
```

**Commit:**
```bash
git add worker/src/index.js
git commit -m "feat: auto-fetch issue counts server-side on repo_created and msg activity"
```

---

### Task 4: Redesign Dashboard frontend using frontend-design skill

**Files:**
- Rewrite: `dashboard/index.html`
- Rewrite: `dashboard/style.css`
- Rewrite: `dashboard/app.js`

**What to do:**

Invoke `frontend-design` skill with this spec:

> Build a premium light-theme SaaS dashboard (Stripe/Linear aesthetic) for a Telegram bot manager. 3 files: index.html, style.css, app.js.
>
> **Header (sticky, frosted glass):**
> - Left: inline SVG logo (simple robot/bot mark) + "Dashboard" title
> - Right: link to https://github.com/yazelin/telegram-copilot-bot (mdi-github icon), link to https://yazelin.github.io (mdi-web icon), settings gear button (mdi-cog-outline), refresh button (mdi-refresh, spins when loading)
>
> **Stats bar (4 cards):**
> - Messages (mdi-message-text-outline), Apps (mdi-package-variant-closed), Draws (mdi-palette-outline), Builds (mdi-hammer-wrench)
> - Keys: totalMessages, totalApps, totalDraws, totalBuilds
> - Skeleton loading state
>
> **Body (2-col desktop, 1-col mobile at 768px):**
> - Left 65%: Repo cards grid
> - Right 35%: Chat history panel
>
> **Repo cards:**
> - Repo name (link to https://github.com/{owner}/{repo}), description
> - Progress bar: issueClosed / issueTotal (from KV data, no GitHub API)
> - "Last activity X ago" + interaction type badges (created/build/msg) — last 3
> - Flat cards, no expand/collapse
>
> **Chat history:**
> - Telegram-style bubbles, scrollable fixed-height panel
> - User = right-aligned, blue fill (#3b82f6)
> - Bot = left-aligned, white with border and shadow
> - Commands starting with / use monospace font + light gray background bubble
> - Timestamp in small text below each bubble
>
> **Config:**
> - Hardcoded defaults: apiUrl = 'https://telegram-copilot-relay.yazelinj303.workers.dev', chatId = '850654509'
> - Settings panel (slide-in from right) with inputs for apiUrl, org (unused now), chatId
> - Save to localStorage
>
> **Data fetching:**
> - fetchStats(apiUrl) → GET /api/stats
> - fetchHistory(apiUrl, chatId) → GET /api/history/{chatId}
> - fetchRepos(apiUrl) → GET /api/repos — returns object { repoName: { description, issueTotal, issueClosed, lastActivity, interactions, command } }
> - NO GitHub API calls at all
>
> **Design tokens:**
> - Background: #f5f6fa
> - Cards: #ffffff
> - Border: #e2e8f0
> - Accent: #3b82f6
> - Text: #0f172a / #475569 / #94a3b8
> - Shadows: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.08)
> - Font: Inter (Google Fonts)
> - Icons: MDI via https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css
> - No emoji anywhere

**After frontend-design generates the files, verify:**
- [ ] No `api.github.com` calls in app.js
- [ ] Header has "Dashboard" not "Telegram Copilot Bot"
- [ ] Both external links present (GitHub repo + yazelin.github.io)
- [ ] RWD works at 768px

**Commit:**
```bash
git add dashboard/
git commit -m "feat: redesign dashboard with premium light theme, pure KV data"
```

---

### Task 5: Push and verify GitHub Pages

**Steps:**

```bash
git push
```

Wait ~60 seconds for Pages to deploy, then open:
`https://yazelin.github.io/telegram-copilot-bot/dashboard/`

Verify:
- [ ] Page loads without console errors
- [ ] Stats show (or 0 if empty)
- [ ] Repo cards render (empty state if no repos)
- [ ] Chat history shows messages
- [ ] No GitHub API calls in Network tab

**Commit if any fixes needed, then tag:**
```bash
git tag -a v3.0 -m "v3.0: memory system + pure KV dashboard"
git push origin v3.0
```
