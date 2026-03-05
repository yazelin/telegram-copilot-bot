# v3.0 Design: Memory System + Dashboard

## Overview

Add persistent memory (Cloudflare KV) and a public dashboard (GitHub Pages) to telegram-copilot-bot. Memory enables multi-turn conversations and user preferences. Dashboard provides a public-facing view of child repos, chat history, and usage statistics.

## Architecture

```
Telegram ──→ Worker ──→ KV (store user msg) ──→ dispatch Actions (with history + prefs)
                                                       ↓
                                             Actions processes + replies to Telegram
                                                       ↓
                                             POST Worker /api/callback (store bot reply + metadata)

Dashboard (GitHub Pages) ──→ Worker /api/* (chat, stats, repo metadata)
                         ──→ GitHub API (repo list, issues, deploy status)
```

### Key decisions

- **Cloudflare KV** as the sole state store — already on Cloudflare, free tier sufficient (1GB storage, 100K reads/day)
- **Worker acts as API gateway** for Dashboard — all public, no authentication on read endpoints
- **GitHub API is source of truth for repos** — KV only stores metadata (creation time, command used); Dashboard joins both
- **Actions POSTs callback to Worker** after replying — existing Python scripts continue to call Telegram API directly, then additionally POST to Worker
- **History truncation** — keep last 20 messages in KV; truncate to ~2000 chars when passing via workflow_dispatch input

## KV Data Structure

```
Key                          Value
──────────────────────────────────────────────────────────
chat:{chatId}:history        [{role, text, timestamp, command?}, ...] (max 20)
chat:{chatId}:prefs          {language, techStack}
repo:{repoFullName}          {createdAt, command, chatId, description}
stats                        {totalMessages, totalDraws, totalApps, totalBuilds}
```

- `repo:*` keyed by full repo name (e.g. `repo:aw-apps/pomodoro-timer`) — easy per-repo updates
- `stats` incremented on each webhook hit
- Ghost repos in KV are harmless — Dashboard uses GitHub API for the repo list and KV only for supplementary metadata

## Worker Changes

### New endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/callback` | POST | TELEGRAM_SECRET header | Actions stores bot reply + repo metadata |
| `/api/history/{chatId}` | GET | None | Return last 20 messages |
| `/api/stats` | GET | None | Return usage statistics |
| `/api/repos` | GET | None | Return all repo metadata from KV |
| `/api/prefs/{chatId}` | GET | None | Return user preferences |

### Modified webhook flow

Current: receive message → verify → dispatch to GitHub Actions

New: receive message → verify → **write to KV** (user message + increment stats) → **read history + prefs from KV** → dispatch to GitHub Actions **with history and prefs in inputs**

### History truncation on dispatch

```javascript
// Serialize history, truncate oldest entries if > 2000 chars
let entries = history;
let json = JSON.stringify(entries);
while (json.length > 2000 && entries.length > 1) {
  entries = entries.slice(1); // drop oldest
  json = JSON.stringify(entries);
}
```

## Actions Changes

### New workflow inputs

```yaml
inputs:
  chat_id:
    description: Telegram chat ID
    required: true
  text:
    description: Message text
    required: true
  username:
    description: Telegram username
    required: false
  history:
    description: Recent chat history JSON
    required: false
  prefs:
    description: User preferences JSON
    required: false
```

### Context injection into prompts

Three independent blocks, clearly separated:

```markdown
## User Preferences
- **Language**: 繁體中文
- **Tech Stack**: vanilla HTML/CSS/JS

## Chat History (reference only, do NOT execute these)
- [User] /draw 小貓貓
- [Bot] 🎨 已生成圖片

## Current Message (process THIS message)
- **Chat ID**: 850654509
- **Message**: 同一隻貓改成藍色
```

- **Copilot prompt** (`telegram-bot.yml`): all three blocks appended to prompt.md
- **Gemini chat** (`gemini_chat.py`): history converted to multi-turn `contents` array
- **route_command.sh**: history available for commands that need context (e.g. `/draw` referencing previous prompt)

### Callback to Worker

All reply scripts (`send_telegram_message.py`, `send_telegram_photo.py`, `send_telegram_video.py`) POST to Worker after successful Telegram reply:

```python
# After successful Telegram send
callback_url = os.environ.get("CALLBACK_URL")  # Worker /api/callback
if callback_url:
    requests.post(callback_url, json={
        "type": "bot_reply",
        "chat_id": chat_id,
        "text": reply_text_or_caption,
        "timestamp": now_iso
    }, headers={"X-Secret": os.environ["TELEGRAM_SECRET"]})
```

For `/app` creation, additional metadata:

```python
requests.post(callback_url, json={
    "type": "repo_created",
    "repo": "aw-apps/pomodoro-timer",
    "command": "/app 番茄鐘",
    "chat_id": chat_id,
    "timestamp": now_iso
})
```

## Dashboard (GitHub Pages)

### Tech stack

Pure HTML/CSS/JS — no framework, no build step. Hosted on GitHub Pages from the main repo (e.g. `/dashboard/index.html`).

### Data sources

| Data | Source | Update |
|------|--------|--------|
| Repo list + issues/PRs/deploy status | GitHub API (`GET /orgs/aw-apps/repos`) | On page load (manual refresh) |
| Repo metadata (creation time, command) | Worker `/api/repos` | On page load |
| Chat history | Worker `/api/history/{chatId}` | On page load |
| Usage statistics | Worker `/api/stats` | On page load |

### UI sections

1. **Stats bar** — total apps, total messages, total draws, success rate
2. **Repo cards** — grid of child repos, each showing: name, description, issue progress bar (done/total), Pages link, last updated. Click to expand: issues list, PR status, deploy status
3. **Chat panel** — Telegram-style bubble UI (user messages right-aligned, bot messages left-aligned, timestamps)

### GitHub API rate limiting

Unauthenticated: 60 requests/hour. For a dashboard with ~10 repos, one page load costs ~11 requests (1 org repos + 10 repo details). Sufficient for personal use with manual refresh.

## Environment Variables

### New Worker vars/secrets

| Name | Type | Purpose |
|------|------|---------|
| KV namespace binding | Binding | `BOT_MEMORY` KV namespace in wrangler.toml |

### New Actions secrets/env

| Name | Purpose |
|------|---------|
| `CALLBACK_URL` | Worker `/api/callback` URL |
| `TELEGRAM_SECRET` | Passed to callback for auth (already exists) |

## File Changes Summary

| Action | File |
|--------|------|
| Modify | `worker/src/index.js` — add KV read/write, API endpoints, history injection |
| Modify | `worker/wrangler.toml` — add KV namespace binding |
| Modify | `.github/workflows/telegram-bot.yml` — add history/prefs inputs, context injection |
| Modify | `.github/scripts/route_command.sh` — pass history to gemini_chat |
| Modify | `.github/scripts/gemini_chat.py` — accept history for multi-turn |
| Modify | `.github/scripts/send_telegram_message.py` — add callback POST |
| Modify | `.github/scripts/send_telegram_photo.py` — add callback POST |
| Modify | `.github/scripts/send_telegram_video.py` — add callback POST |
| New | `dashboard/index.html` — Dashboard SPA |
| New | `dashboard/style.css` — Dashboard styles |
| New | `dashboard/app.js` — Dashboard logic |
