# Dashboard v2 Design — Pure KV, No GitHub API

Date: 2026-03-06

## Goal

Redesign Dashboard to use only Cloudflare KV data (via Worker API).
No direct GitHub API calls from the browser. No rate limit issues.
High-quality frontend using frontend-design skill.

## Approach

Plan A: Pure KV. All repo/issue data stored in KV when bot operates.
Dashboard only calls 3 Worker endpoints.

## KV Data Architecture

### Existing keys (unchanged)
```
stats                  → { totalMessages, totalApps, totalDraws, totalBuilds }
chat:{id}:user         → [ {role, text, timestamp}, ... ]
chat:{id}:bot          → [ {role, text, timestamp}, ... ]
chat:{id}:prefs        → { language, techStack }
```

### repo:{name} — expanded schema
```json
{
  "createdAt": "ISO8601",
  "command": "/app ...",
  "chatId": "850654509",
  "description": "...",
  "issueTotal": 12,
  "issueClosed": 9,
  "lastActivity": "ISO8601",
  "interactions": [
    { "type": "created", "timestamp": "ISO8601" },
    { "type": "build",   "timestamp": "ISO8601" },
    { "type": "msg",     "timestamp": "ISO8601" }
  ]
}
```

### Update triggers
| Bot command | KV update |
|-------------|-----------|
| `/app`      | Write new repo, fetch issue counts once via GITHUB_TOKEN |
| `/build`    | Append `build` to interactions, update lastActivity |
| `/msg`      | Append `msg` to interactions, update lastActivity, refresh issue counts |

Issue counts fetched server-side (Worker → GitHub with GITHUB_TOKEN, 5000 req/hr).
Never fetched from browser.

## Worker API

No new endpoints. Dashboard uses:
```
GET /api/stats           → stats object
GET /api/history/:chatId → merged user+bot history array
GET /api/repos           → { repoName: repoData, ... }
```

## Dashboard UI

### Layout (desktop 2-col, mobile single-col)
```
Header: [logo] Dashboard    [GitHub Repo] [yazelin.github.io] [Settings] [Refresh]
Stats bar: 4 stat cards
Body: Repos (65%) | Chat History (35%)
```

### Header
- Left: small logo SVG + "Dashboard" text
- Right: GitHub repo link, personal site link, settings gear, refresh button
- Style: frosted glass, sticky

### Stats bar
- 4 cards: Messages, Apps, Draws, Builds
- MDI icons, no emoji

### Repo cards
- Repo name, description
- Progress bar: issueClosed / issueTotal (snapshot from last bot activity)
- "Last activity: Xh ago" + interaction type badges (created / build / msg)
- No expand/collapse, no per-issue list

### Chat history
- Telegram-style bubbles
- User = right-aligned blue bubble
- Bot = left-aligned white bubble with shadow
- Commands (/) styled differently (monospace, subtle bg)

### Design style
- Light theme: white cards, #f5f6fa background
- Stripe/Linear feel: generous whitespace, subtle shadows
- Inter font, MDI icons
- No emoji anywhere

### Links to add
- GitHub repo: https://github.com/yazelin/telegram-copilot-bot
- Personal site: https://yazelin.github.io

## Frontend Notes
- Use `frontend-design` skill for high-quality implementation
- 3 files max: index.html, style.css, app.js
- Defaults hardcoded (Worker URL, chatId) — no manual setup needed
- localStorage for overrides via settings panel
