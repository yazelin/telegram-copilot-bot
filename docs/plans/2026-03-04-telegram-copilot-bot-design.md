# telegram-copilot-bot Design

## Goal

Build a standalone Telegram chatbot powered by GitHub Copilot CLI, running on GitHub Actions — completely independent of gh-aw framework. Replicates aw-telegram-bot's functionality using only standard GitHub Actions YAML + `npm install -g @github/copilot`.

## Architecture

```
User (Telegram)
    │
    ▼
Cloudflare Worker (webhook relay)
├─ Validates user whitelist
├─ Verifies Telegram secret token
    │
    ▼
GitHub Actions (workflow_dispatch)
    │
    ▼
ubuntu-latest runner
├─ actions/checkout
├─ actions/setup-node
├─ npm install -g @github/copilot
├─ Setup ~/.copilot/mcp-config.json
├─ copilot --autopilot --yolo -p "<prompt>"
    │
    ▼
Response → Telegram API
```

## Project Structure

```
telegram-copilot-bot/
├── .github/
│   ├── workflows/
│   │   ├── telegram-bot.yml     # Main workflow (hand-written YAML)
│   │   └── notify.yml           # Callback notification workflow
│   └── scripts/                 # Python tool scripts (replaces safe-inputs)
│       ├── send_telegram_message.py
│       ├── send_telegram_photo.py
│       ├── send_telegram_video.py
│       ├── download_video.py
│       ├── create_repo.py
│       ├── fork_repo.py
│       ├── setup_repo.py
│       ├── create_issues.py
│       ├── setup_secrets.py
│       ├── trigger_workflow.py
│       ├── post_comment.py
│       └── manage_labels.py
├── worker/
│   └── src/
│       └── index.js             # New Cloudflare Worker
├── prompt.md                    # AI system prompt
└── README.md
```

## Features

All features from aw-telegram-bot:

1. **Chat** — AI conversation (auto-judge mode)
2. **Image generation** — `/draw <description>` via Nanobanana MCP + Gemini
3. **Research** — `/research <topic>` via Tavily MCP + web-search
4. **Translation** — `/translate <text>`
5. **Video download** — `/download <url>` via yt-dlp
6. **App Factory** — `/app <description>` creates repos, issues, triggers builds
7. **Build trigger** — `/build <owner/repo>` triggers implement.yml
8. **Issue creation** — `/issue <owner/repo> <description>`
9. **Message relay** — `/msg <owner/repo>#<number> <message>`

## Key Differences from aw-telegram-bot

| Item | aw-telegram-bot | telegram-copilot-bot |
|------|----------------|---------------------|
| Framework | gh-aw + `gh aw compile` | None, hand-written YAML |
| Copilot install | gh-aw actions | `npm install -g @github/copilot` |
| Auth | `COPILOT_GITHUB_TOKEN` (gh-aw) | Fine-grained PAT with Copilot Requests |
| Firewall | awf container (squid proxy) | None (personal bot) |
| MCP Gateway | gh-aw-mcpg container | Copilot CLI built-in MCP |
| Safe-inputs | gh-aw MCP server | Shell tool → Python scripts |
| MCP servers | Docker via gateway | `~/.copilot/mcp-config.json` |
| Prompt | .md frontmatter + system prompt | prompt.md → `-p` flag |

## MCP Configuration

`~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "nanobanana": {
      "type": "local",
      "command": "docker",
      "args": [
        "run", "-i", "--rm", "-v", "/tmp:/tmp:rw",
        "-e", "NANOBANANA_GEMINI_API_KEY",
        "-e", "NANOBANANA_OUTPUT_DIR=/tmp/nanobanana-output",
        "-e", "NANOBANANA_MODEL=gemini-3-pro-image-preview",
        "-e", "NANOBANANA_FALLBACK_MODELS=gemini-3.1-flash-image-preview,gemini-2.5-flash-image",
        "-e", "NANOBANANA_TIMEOUT=120",
        "ghcr.io/astral-sh/uv:python3.12-alpine",
        "uvx", "nanobanana-py"
      ],
      "tools": ["generate_image"]
    },
    "tavily": {
      "type": "http",
      "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}"
    }
  }
}
```

## Secrets Required

| Secret | Purpose |
|--------|---------|
| `PERSONAL_ACCESS_TOKEN` | Fine-grained PAT with Copilot Requests permission |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token |
| `GEMINI_API_KEY` | Nanobanana image generation |
| `TAVILY_API_KEY` | Web search |
| `FACTORY_PAT` | App Factory: create repos, issues, secrets |
| `COPILOT_PAT` | App Factory: child repo Copilot token |
| `CHILD_COPILOT_TOKEN` | App Factory: child Copilot token value |
| `NOTIFY_TOKEN` | Notification callback |
| `TELEGRAM_SECRET` | Cloudflare Worker verification |

## Workflow YAML Core

```yaml
name: "Telegram Chatbot"
on:
  workflow_dispatch:
    inputs:
      chat_id:
        description: Telegram chat ID
        required: true
      text:
        description: Message text
        required: true
      username:
        description: Telegram username

jobs:
  agent:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v4
      - run: npm install -g @github/copilot
      - name: Setup MCP config
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}
        run: |
          mkdir -p ~/.copilot
          envsubst < .github/mcp-config.template.json > ~/.copilot/mcp-config.json
      - name: Run Copilot agent
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          FACTORY_PAT: ${{ secrets.FACTORY_PAT }}
          COPILOT_PAT: ${{ secrets.COPILOT_PAT }}
          CHILD_COPILOT_TOKEN: ${{ secrets.CHILD_COPILOT_TOKEN }}
          NOTIFY_TOKEN: ${{ secrets.NOTIFY_TOKEN }}
        run: |
          PROMPT=$(cat prompt.md)
          PROMPT=$(printf "%s\n\n## Message\n- Chat ID: %s\n- Username: %s\n- Message: %s" \
            "$PROMPT" \
            "${{ inputs.chat_id }}" \
            "${{ inputs.username }}" \
            "${{ inputs.text }}")
          copilot --autopilot --yolo -p "$PROMPT"
```

## Cloudflare Worker

New worker with same logic as aw-telegram-bot:
- Receive Telegram webhook POST
- Validate user against whitelist
- Verify Telegram secret token
- Dispatch to GitHub Actions via workflow_dispatch API
- Different repo target (this repo instead of aw-telegram-bot)

## Tool Scripts

Python scripts in `.github/scripts/` replace gh-aw safe-inputs. Copilot CLI calls them via shell tool. Each script:
- Reads inputs from command-line arguments or environment variables
- Outputs JSON result to stdout
- Uses only stdlib (`urllib`, `json`, `os`, `subprocess`)
- No external dependencies needed

## Prompt

`prompt.md` contains the full system prompt — extracted from aw-telegram-bot's `telegram-bot.md` markdown body (everything after the frontmatter). Adjusted to reference `.github/scripts/` instead of safe-inputs.
