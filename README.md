# telegram-copilot-bot

Telegram chatbot powered by GitHub Copilot CLI, running on GitHub Actions.

Standalone version — no gh-aw dependency. Uses `npm install -g @github/copilot` directly.

## Features

- AI chat (auto-judge mode)
- Image generation (`/draw`) via Nanobanana + Gemini
- Research (`/research`) via Tavily
- Translation (`/translate`)
- Video download (`/download`) via yt-dlp
- App Factory (`/app`) — create repos, issues, trigger builds
- Build trigger (`/build`)
- Issue creation (`/issue`)
- Message relay (`/msg`)

## Architecture

```
Telegram → Cloudflare Worker → GitHub Actions (workflow_dispatch)
                                     ↓
                              Copilot CLI + MCP servers
                                     ↓
                              Response → Telegram
```

## Setup

### 1. Create GitHub repo

Create a new repo and push this code.

### 2. Set repository secrets

| Secret | Description |
|--------|-------------|
| `PERSONAL_ACCESS_TOKEN` | Fine-grained PAT with Copilot Requests permission |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `GEMINI_API_KEY` | Google Gemini API key (for image generation) |
| `TAVILY_API_KEY` | Tavily API key (for web search) |
| `FACTORY_PAT` | PAT for App Factory operations |
| `COPILOT_PAT` | Copilot PAT for child repos |
| `CHILD_COPILOT_TOKEN` | Copilot token for child repos |
| `NOTIFY_TOKEN` | Token for notification callbacks |

### 3. Deploy Cloudflare Worker

```bash
cd worker
npm install
```

Set worker secrets:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put GITHUB_OWNER
npx wrangler secret put GITHUB_REPO
```

Update `ALLOWED_USERS` in `wrangler.toml` with your Telegram user ID.

Deploy:
```bash
npm run deploy
```

### 4. Register webhook

Visit: `https://your-worker.workers.dev/register?token=YOUR_TELEGRAM_SECRET`

### 5. Test

Send a message to your Telegram bot!
