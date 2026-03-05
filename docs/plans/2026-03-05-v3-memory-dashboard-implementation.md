# v3.0 Memory System + Dashboard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add persistent chat memory (Cloudflare KV) and a public dashboard (GitHub Pages) to telegram-copilot-bot.

**Architecture:** Cloudflare Worker gains KV storage for chat history, user prefs, and stats. Worker injects history+prefs into GitHub Actions dispatch inputs. Actions callback to Worker after replying. Dashboard is a static SPA on GitHub Pages fetching from Worker API + GitHub API.

**Tech Stack:** Cloudflare Workers + KV, vanilla HTML/CSS/JS for dashboard.

---

### Task 1: Add KV namespace to Worker config

**Files:**
- Modify: `worker/wrangler.toml`

**Step 1: Add KV namespace binding to wrangler.toml**

Add after the `[vars]` section:

```toml
[[kv_namespaces]]
binding = "BOT_MEMORY"
id = ""
```

The `id` will be filled after creating the namespace.

**Step 2: Create the KV namespace via Wrangler**

Run:
```bash
cd worker
npx wrangler kv namespace create BOT_MEMORY
```

Expected: Output like `Add the following to your configuration file... id = "abc123..."`

**Step 3: Update wrangler.toml with the actual namespace ID**

Copy the `id` from Step 2 output into `wrangler.toml`.

**Step 4: Create a preview namespace for local dev**

Run:
```bash
npx wrangler kv namespace create BOT_MEMORY --preview
```

Add `preview_id` to the binding in `wrangler.toml`.

**Step 5: Commit**

```bash
git add worker/wrangler.toml
git commit -m "feat: add Cloudflare KV namespace for bot memory"
```

---

### Task 2: Add KV helper functions to Worker

**Files:**
- Modify: `worker/src/index.js`

**Step 1: Add KV helper functions at the top of the file (after the export default block)**

```javascript
// --- KV Helpers ---

const MAX_HISTORY = 20;
const MAX_HISTORY_JSON_LENGTH = 2000;

async function appendHistory(kv, chatId, entry) {
  const key = `chat:${chatId}:history`;
  let history = [];
  try {
    const existing = await kv.get(key, "json");
    if (Array.isArray(existing)) history = existing;
  } catch {}
  history.push(entry);
  if (history.length > MAX_HISTORY) {
    history = history.slice(-MAX_HISTORY);
  }
  await kv.put(key, JSON.stringify(history));
  return history;
}

async function getHistory(kv, chatId) {
  const key = `chat:${chatId}:history`;
  try {
    const history = await kv.get(key, "json");
    return Array.isArray(history) ? history : [];
  } catch {
    return [];
  }
}

function truncateHistoryForDispatch(history) {
  let entries = [...history];
  let json = JSON.stringify(entries);
  while (json.length > MAX_HISTORY_JSON_LENGTH && entries.length > 1) {
    entries = entries.slice(1);
    json = JSON.stringify(entries);
  }
  return json;
}

async function getPrefs(kv, chatId) {
  try {
    const prefs = await kv.get(`chat:${chatId}:prefs`, "json");
    return prefs || {};
  } catch {
    return {};
  }
}

async function incrementStats(kv, field) {
  const stats = (await kv.get("stats", "json")) || {};
  stats[field] = (stats[field] || 0) + 1;
  await kv.put("stats", JSON.stringify(stats));
  return stats;
}
```

**Step 2: Verify syntax**

Run:
```bash
cd worker && npx wrangler deploy --dry-run
```

Expected: No syntax errors.

**Step 3: Commit**

```bash
git add worker/src/index.js
git commit -m "feat: add KV helper functions for history, prefs, stats"
```

---

### Task 3: Modify webhook flow to store messages and inject history

**Files:**
- Modify: `worker/src/index.js` — `handleWebhook()` and `dispatchToGitHub()`

**Step 1: Update handleWebhook to store user message and pass KV to dispatch**

Replace the existing `handleWebhook` function:

```javascript
async function handleWebhook(request, env, ctx) {
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== env.TELEGRAM_SECRET) {
    return new Response("Unauthorized", { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  if (!update.message?.text) {
    return new Response("OK", { status: 200 });
  }

  const msg = update.message;
  const userId = String(msg.from?.id || "");
  const chatId = String(msg.chat.id);
  const allowedUsers = (env.ALLOWED_USERS || "").split(",").map(s => s.trim()).filter(Boolean);
  const allowedChats = (env.ALLOWED_CHATS || "").split(",").map(s => s.trim()).filter(Boolean);

  if (!allowedUsers.includes(userId) && !allowedChats.includes(chatId)) {
    return new Response("OK", { status: 200 });
  }

  ctx.waitUntil((async () => {
    // Store user message in KV
    await appendHistory(env.BOT_MEMORY, chatId, {
      role: "user",
      text: msg.text,
      timestamp: new Date().toISOString(),
    });

    // Increment stats
    await incrementStats(env.BOT_MEMORY, "totalMessages");

    // Increment command-specific stats
    const cmd = msg.text.split(" ")[0].toLowerCase();
    if (cmd === "/draw") await incrementStats(env.BOT_MEMORY, "totalDraws");
    if (cmd === "/app") await incrementStats(env.BOT_MEMORY, "totalApps");
    if (cmd === "/build") await incrementStats(env.BOT_MEMORY, "totalBuilds");

    // Read history + prefs, then dispatch
    const history = await getHistory(env.BOT_MEMORY, chatId);
    const prefs = await getPrefs(env.BOT_MEMORY, chatId);
    await dispatchToGitHub(update, env, history, prefs);
  })());

  return new Response("OK", { status: 200 });
}
```

**Step 2: Update dispatchToGitHub to include history and prefs in inputs**

Replace the existing `dispatchToGitHub` function:

```javascript
async function dispatchToGitHub(update, env, history, prefs) {
  const msg = update.message;
  const workflowFile = "telegram-bot.yml";

  // Truncate history to fit workflow_dispatch input limits
  const historyJson = truncateHistoryForDispatch(history.slice(0, -1)); // exclude current msg (already in text)
  const prefsJson = JSON.stringify(prefs);

  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/actions/workflows/${workflowFile}/dispatches`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "telegram-copilot-bot",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: {
          chat_id: String(msg.chat.id),
          text: msg.text,
          username: msg.from?.username || "",
          history: historyJson,
          prefs: prefsJson,
        },
      }),
    }
  );

  if (!response.ok) {
    console.error("GitHub dispatch failed:", response.status, await response.text());
  }
}
```

**Step 3: Verify syntax**

Run:
```bash
cd worker && npx wrangler deploy --dry-run
```

**Step 4: Commit**

```bash
git add worker/src/index.js
git commit -m "feat: store user messages in KV and inject history into dispatch"
```

---

### Task 4: Add API endpoints to Worker

**Files:**
- Modify: `worker/src/index.js` — main `fetch` handler

**Step 1: Add CORS helper**

Add after the KV helpers:

```javascript
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Secret",
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
```

**Step 2: Add callback endpoint handler**

```javascript
async function handleCallback(request, env) {
  const secret = request.headers.get("X-Secret");
  if (secret !== env.TELEGRAM_SECRET) {
    return jsonResponse({ error: "Unauthorized" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Bad Request" }, 400);
  }

  const { type, chat_id, text, timestamp, repo, command, description } = body;

  if (type === "bot_reply" && chat_id && text) {
    await appendHistory(env.BOT_MEMORY, chat_id, {
      role: "bot",
      text: text.slice(0, 500), // truncate long replies
      timestamp: timestamp || new Date().toISOString(),
    });
  }

  if (type === "repo_created" && repo) {
    await env.BOT_MEMORY.put(`repo:${repo}`, JSON.stringify({
      createdAt: timestamp || new Date().toISOString(),
      command: command || "",
      chatId: chat_id || "",
      description: description || "",
    }));
  }

  return jsonResponse({ ok: true });
}
```

**Step 3: Update the main fetch handler to route API endpoints**

Replace the `export default` block:

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    // Webhook
    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }

    // Register webhook
    if (url.pathname === "/register") {
      const token = url.searchParams.get("token");
      if (token !== env.TELEGRAM_SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }
      return registerWebhook(url, env);
    }

    // API: callback from Actions
    if (url.pathname === "/api/callback" && request.method === "POST") {
      return handleCallback(request, env);
    }

    // API: chat history
    const historyMatch = url.pathname.match(/^\/api\/history\/(\d+)$/);
    if (historyMatch && request.method === "GET") {
      const history = await getHistory(env.BOT_MEMORY, historyMatch[1]);
      return jsonResponse(history);
    }

    // API: stats
    if (url.pathname === "/api/stats" && request.method === "GET") {
      const stats = (await env.BOT_MEMORY.get("stats", "json")) || {};
      return jsonResponse(stats);
    }

    // API: repos metadata
    if (url.pathname === "/api/repos" && request.method === "GET") {
      const list = await env.BOT_MEMORY.list({ prefix: "repo:" });
      const repos = {};
      for (const key of list.keys) {
        const val = await env.BOT_MEMORY.get(key.name, "json");
        if (val) repos[key.name.replace("repo:", "")] = val;
      }
      return jsonResponse(repos);
    }

    // API: user prefs
    const prefsMatch = url.pathname.match(/^\/api\/prefs\/(\d+)$/);
    if (prefsMatch && request.method === "GET") {
      const prefs = await getPrefs(env.BOT_MEMORY, prefsMatch[1]);
      return jsonResponse(prefs);
    }

    return new Response("telegram-copilot-bot relay", { status: 200 });
  },
};
```

**Step 4: Verify syntax**

Run:
```bash
cd worker && npx wrangler deploy --dry-run
```

**Step 5: Commit**

```bash
git add worker/src/index.js
git commit -m "feat: add API endpoints for callback, history, stats, repos, prefs"
```

---

### Task 5: Deploy Worker and test KV endpoints

**Step 1: Deploy**

Run:
```bash
cd worker && npm run deploy
```

**Step 2: Test stats endpoint**

Run:
```bash
curl https://telegram-copilot-relay.<subdomain>.workers.dev/api/stats
```

Expected: `{}` or `{"totalMessages":0}`

**Step 3: Send a test message via Telegram**

Send `hi` to the bot.

**Step 4: Verify message was stored**

Run:
```bash
curl https://telegram-copilot-relay.<subdomain>.workers.dev/api/history/850654509
```

Expected: JSON array with at least one `{"role":"user","text":"hi",...}` entry.

**Step 5: Verify stats incremented**

Run:
```bash
curl https://telegram-copilot-relay.<subdomain>.workers.dev/api/stats
```

Expected: `{"totalMessages":1}`

---

### Task 6: Add callback POST to Python reply scripts

**Files:**
- Modify: `.github/scripts/send_telegram_message.py`
- Modify: `.github/scripts/send_telegram_photo.py`
- Modify: `.github/scripts/send_telegram_video.py`

**Step 1: Add callback helper function to send_telegram_message.py**

Add before `if __name__`:

```python
def post_callback(chat_id, text):
    callback_url = os.environ.get("CALLBACK_URL", "")
    secret = os.environ.get("TELEGRAM_SECRET", "")
    if not callback_url:
        return
    try:
        from datetime import datetime, timezone
        payload = json.dumps({
            "type": "bot_reply",
            "chat_id": chat_id,
            "text": text[:500],
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }).encode()
        req = urllib.request.Request(
            callback_url,
            data=payload,
            headers={"Content-Type": "application/json", "X-Secret": secret},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass  # callback failure should never break the reply
```

Update `main()` — add callback after the successful print:

```python
def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: send_telegram_message.py <chat_id> <text>"}))
        sys.exit(1)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = sys.argv[1]
    text = sys.argv[2]
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))
    post_callback(chat_id, text)
```

**Step 2: Add same callback to send_telegram_photo.py**

Add the same `post_callback` function. Update `main()` — add after the success print:

```python
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))
    post_callback(chat_id, caption or "[photo]")
```

**Step 3: Add same callback to send_telegram_video.py**

Add the same `post_callback` function. Update `main()` — add after the success print:

```python
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))
    post_callback(chat_id, caption or "[video]")
```

**Step 4: Commit**

```bash
git add .github/scripts/send_telegram_message.py .github/scripts/send_telegram_photo.py .github/scripts/send_telegram_video.py
git commit -m "feat: add callback POST to Worker after Telegram replies"
```

---

### Task 7: Add history and prefs inputs to telegram-bot.yml

**Files:**
- Modify: `.github/workflows/telegram-bot.yml`

**Step 1: Add new workflow inputs**

Add after the `username` input:

```yaml
      history:
        description: Recent chat history JSON
        required: false
      prefs:
        description: User preferences JSON
        required: false
```

**Step 2: Add CALLBACK_URL and TELEGRAM_SECRET to Route command env**

Add to the `Route command` step's `env:` block:

```yaml
          HISTORY: ${{ inputs.history }}
          CALLBACK_URL: ${{ secrets.CALLBACK_URL }}
          TELEGRAM_SECRET: ${{ secrets.TELEGRAM_SECRET }}
```

**Step 3: Add CALLBACK_URL and TELEGRAM_SECRET to Run Copilot agent env**

Add to the `Run Copilot agent` step's `env:` block:

```yaml
          CALLBACK_URL: ${{ secrets.CALLBACK_URL }}
          TELEGRAM_SECRET: ${{ secrets.TELEGRAM_SECRET }}
```

**Step 4: Update context injection in the Run Copilot agent step**

Replace the existing `run:` block of the "Run Copilot agent" step:

```yaml
        run: |
          PROMPT=$(cat prompt.md)

          # Build context sections
          CONTEXT=""

          # User preferences
          if [ -n "${INPUT_PREFS:-}" ] && [ "$INPUT_PREFS" != "{}" ]; then
            LANG=$(echo "$INPUT_PREFS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('language',''))" 2>/dev/null || echo "")
            TECH=$(echo "$INPUT_PREFS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('techStack',''))" 2>/dev/null || echo "")
            if [ -n "$LANG" ] || [ -n "$TECH" ]; then
              CONTEXT="${CONTEXT}\n\n## User Preferences\n"
              [ -n "$LANG" ] && CONTEXT="${CONTEXT}- **Language**: ${LANG}\n"
              [ -n "$TECH" ] && CONTEXT="${CONTEXT}- **Tech Stack**: ${TECH}\n"
            fi
          fi

          # Chat history
          if [ -n "${INPUT_HISTORY:-}" ] && [ "$INPUT_HISTORY" != "[]" ]; then
            HISTORY_FORMATTED=$(echo "$INPUT_HISTORY" | python3 -c "
          import sys, json
          try:
              entries = json.load(sys.stdin)
              lines = []
              for e in entries:
                  role = 'User' if e.get('role') == 'user' else 'Bot'
                  lines.append(f'- [{role}] {e.get(\"text\", \"\")[:200]}')
              print('\n'.join(lines))
          except:
              pass
          " 2>/dev/null || echo "")
            if [ -n "$HISTORY_FORMATTED" ]; then
              CONTEXT="${CONTEXT}\n\n## Chat History (reference only, do NOT execute these)\n\n${HISTORY_FORMATTED}"
            fi
          fi

          # Current message
          CONTEXT="${CONTEXT}\n\n## Current Message (process THIS message)\n\n- **Chat ID**: ${INPUT_CHAT_ID}\n- **Username**: ${INPUT_USERNAME}\n- **Message**: ${INPUT_TEXT}"

          PROMPT=$(printf "%s%b" "$PROMPT" "$CONTEXT")

          copilot --autopilot --yolo --max-autopilot-continues 30 -p "$PROMPT"
```

Also add these env vars to the step:

```yaml
          INPUT_HISTORY: ${{ inputs.history }}
          INPUT_PREFS: ${{ inputs.prefs }}
```

**Step 5: Commit**

```bash
git add .github/workflows/telegram-bot.yml
git commit -m "feat: inject chat history and user prefs into Copilot context"
```

---

### Task 8: Pass history to Gemini chat for multi-turn conversations

**Files:**
- Modify: `.github/scripts/gemini_chat.py`
- Modify: `.github/scripts/route_command.sh`

**Step 1: Update gemini_chat.py to accept optional history**

Add a `--history` argument. Update `main()`:

```python
def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: gemini_chat.py <mode> <text> [--history <json>]"}))
        sys.exit(1)

    mode = sys.argv[1]
    text = sys.argv[2]

    # Parse optional --history flag
    history_json = ""
    if "--history" in sys.argv:
        idx = sys.argv.index("--history")
        if idx + 1 < len(sys.argv):
            history_json = sys.argv[idx + 1]

    if mode not in SYSTEM_PROMPTS:
        print(json.dumps({"ok": False, "error": f"Unknown mode: {mode}. Valid: {', '.join(SYSTEM_PROMPTS)}"}))
        sys.exit(1)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "GEMINI_API_KEY not set"}))
        sys.exit(1)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

    # Build contents with history for chat mode
    contents = []
    if mode == "chat" and history_json:
        try:
            history = json.loads(history_json)
            for entry in history:
                role = "user" if entry.get("role") == "user" else "model"
                contents.append({"role": role, "parts": [{"text": entry.get("text", "")}]})
        except (json.JSONDecodeError, TypeError):
            pass

    contents.append({"role": "user", "parts": [{"text": text}]})

    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPTS[mode]}]
        },
    }
```

The rest of the function (request, response parsing) stays the same.

**Step 2: Update route_command.sh to pass history to gemini_chat**

In the default `*` case (around line 219), change:

```bash
  *)
    # No command prefix: try Gemini chat, fallback to Copilot
    if [ -z "${GEMINI_API_KEY:-}" ]; then
      set_output true
      exit 0
    fi
    HISTORY_ARG=""
    if [ -n "${HISTORY:-}" ] && [ "$HISTORY" != "[]" ]; then
      HISTORY_ARG="--history $HISTORY"
    fi
    RESULT=$(gemini_chat chat "$TEXT" $HISTORY_ARG) || true
```

Note: `$HISTORY_ARG` is intentionally unquoted so that when empty, no extra args are passed, and when set, `--history` and the JSON are separate args.

**Step 3: Commit**

```bash
git add .github/scripts/gemini_chat.py .github/scripts/route_command.sh
git commit -m "feat: multi-turn Gemini chat with conversation history"
```

---

### Task 9: Set CALLBACK_URL as GitHub secret

**Step 1: Set the secret**

Run:
```bash
WORKER_URL="https://telegram-copilot-relay.<subdomain>.workers.dev"
echo "${WORKER_URL}/api/callback" | gh secret set CALLBACK_URL
```

**Step 2: Also set TELEGRAM_SECRET as a GitHub secret (if not already set)**

Run:
```bash
gh secret list | grep TELEGRAM_SECRET || echo "Need to set TELEGRAM_SECRET"
```

If not set, it needs to be set manually (it was generated during setup.sh).

---

### Task 10: Create Dashboard HTML

**Files:**
- Create: `dashboard/index.html`

**Step 1: Create the dashboard directory and index.html**

```bash
mkdir -p dashboard
```

Create `dashboard/index.html` — a single-page app with:
- Header with title "Telegram Copilot Bot Dashboard"
- Stats bar (4 cards: Total Messages, Total Apps, Total Draws, Total Builds)
- Two-column layout: Repo cards (left/main), Chat panel (right/sidebar)
- Repo cards: name, description, issue progress bar, Pages link, expand for details
- Chat panel: Telegram-style bubbles (user right, bot left, timestamps)
- Config section at top for: Worker API URL, GitHub Org, Chat ID
- Refresh button
- Mobile responsive

The page should:
1. On load, read config from `localStorage` or prompt user
2. Fetch from Worker `/api/stats`, `/api/history/{chatId}`, `/api/repos`
3. Fetch from GitHub API `GET /orgs/{org}/repos?sort=updated&per_page=30`
4. For each repo, fetch issues: `GET /repos/{org}/{repo}/issues?state=all`
5. Render all sections

**Step 2: Commit**

```bash
git add dashboard/
git commit -m "feat: add Dashboard SPA with repo cards and chat panel"
```

---

### Task 11: Create Dashboard styles

**Files:**
- Create: `dashboard/style.css`

**Step 1: Create styles**

Key design requirements:
- Dark theme (matches developer aesthetic)
- Stats cards: grid, 4 columns, colored accent borders
- Repo cards: rounded corners, hover effect, progress bar for issues
- Chat bubbles: user messages blue/right-aligned, bot messages grey/left-aligned
- Timestamps: small, muted text
- Mobile: single column, chat panel below repos
- Config panel: collapsible

**Step 2: Commit**

```bash
git add dashboard/style.css
git commit -m "feat: add Dashboard dark theme styles with chat bubbles"
```

---

### Task 12: Create Dashboard JavaScript

**Files:**
- Create: `dashboard/app.js`

**Step 1: Create app.js**

Functions needed:

```javascript
// Config management
function getConfig()           // read from localStorage
function saveConfig(config)    // save to localStorage
function showConfigPanel()     // show/hide config inputs

// Data fetching
async function fetchStats(apiUrl)
async function fetchHistory(apiUrl, chatId)
async function fetchRepoMeta(apiUrl)
async function fetchGitHubRepos(org)
async function fetchRepoIssues(org, repo)

// Rendering
function renderStats(stats)
function renderRepos(ghRepos, kvMeta)
function renderRepoCard(repo, meta, issues)
function renderChat(history)
function renderChatBubble(entry)

// Main
async function refresh()      // fetch all + render all
function init()               // check config, show panel or refresh
```

GitHub API calls use `fetch()` with no auth (public repos). Handle 403 rate limit gracefully.

**Step 2: Commit**

```bash
git add dashboard/app.js
git commit -m "feat: add Dashboard app logic with GitHub API integration"
```

---

### Task 13: Enable GitHub Pages for Dashboard

**Step 1: Push all changes**

```bash
git push
```

**Step 2: Enable GitHub Pages**

Run:
```bash
gh api repos/yazelin/telegram-copilot-bot/pages -X POST \
  -f "source[branch]=main" -f "source[path]=/dashboard" 2>/dev/null \
  || gh api repos/yazelin/telegram-copilot-bot/pages -X PUT \
  -f "source[branch]=main" -f "source[path]=/dashboard"
```

Or if Pages is already enabled for `/`, the dashboard will be available at `https://yazelin.github.io/telegram-copilot-bot/dashboard/`.

**Step 3: Verify**

Open `https://yazelin.github.io/telegram-copilot-bot/dashboard/` in browser.

---

### Task 14: End-to-end test

**Step 1: Send a message to the bot**

Send `hi` via Telegram.

**Step 2: Verify history stored**

```bash
curl https://telegram-copilot-relay.<subdomain>.workers.dev/api/history/850654509
```

Expected: Array with user "hi" and bot reply entries.

**Step 3: Verify stats**

```bash
curl https://telegram-copilot-relay.<subdomain>.workers.dev/api/stats
```

Expected: `totalMessages` incremented.

**Step 4: Test multi-turn**

Send `hi` then `你剛剛說了什麼？` — bot should reference the previous conversation.

**Step 5: Test Dashboard**

Open dashboard, configure Worker URL and Chat ID, verify:
- Stats cards show correct numbers
- Repo cards load from GitHub API
- Chat panel shows conversation with bubbles

**Step 6: Update README version history**

Confirm v3.0 tag entry is up to date.

**Step 7: Commit any remaining changes and tag**

```bash
git push
git tag -a v3.0 -m "v3.0: Memory system + Dashboard"
git push origin v3.0
```
