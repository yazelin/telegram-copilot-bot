# telegram-copilot-bot Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone Telegram chatbot on GitHub Actions using Copilot CLI (`npm install -g @github/copilot`), without any gh-aw dependency.

**Architecture:** Cloudflare Worker receives Telegram webhooks, dispatches to GitHub Actions via workflow_dispatch. The workflow installs Copilot CLI via npm, configures MCP servers (nanobanana, tavily), and runs the agent with `--autopilot --yolo -p`. Tool scripts in `.github/scripts/` handle Telegram API calls, GitHub operations, and video downloads.

**Tech Stack:** GitHub Actions, Copilot CLI (`@github/copilot`), Cloudflare Workers, Python 3 scripts, Docker (for MCP servers)

---

### Task 1: Project scaffold and Cloudflare Worker

**Files:**
- Create: `/home/ct/telegram-copilot-bot/worker/src/index.js`
- Create: `/home/ct/telegram-copilot-bot/worker/wrangler.toml`
- Create: `/home/ct/telegram-copilot-bot/worker/package.json`

**Step 1: Create worker/package.json**

```json
{
  "name": "telegram-copilot-relay",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "wrangler": "^4"
  }
}
```

**Step 2: Create worker/wrangler.toml**

```toml
name = "telegram-copilot-relay"
main = "src/index.js"
compatibility_date = "2024-01-01"

[vars]
ALLOWED_USERS = ""
ALLOWED_CHATS = ""
```

Note: `ALLOWED_USERS` and `ALLOWED_CHATS` should be set to the user's Telegram user IDs / chat IDs (comma-separated).

**Step 3: Create worker/src/index.js**

```javascript
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/webhook" && request.method === "POST") {
      return handleWebhook(request, env, ctx);
    }

    if (url.pathname === "/register") {
      const token = url.searchParams.get("token");
      if (token !== env.TELEGRAM_SECRET) {
        return new Response("Unauthorized", { status: 403 });
      }
      return registerWebhook(url, env);
    }

    return new Response("telegram-copilot-bot relay", { status: 200 });
  },
};

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

  ctx.waitUntil(dispatchToGitHub(update, env));
  return new Response("OK", { status: 200 });
}

async function dispatchToGitHub(update, env) {
  const msg = update.message;
  const workflowFile = "telegram-bot.yml";

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
        },
      }),
    }
  );

  if (!response.ok) {
    console.error("GitHub dispatch failed:", response.status, await response.text());
  }
}

async function registerWebhook(requestUrl, env) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}/webhook`;
  try {
    const result = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          secret_token: env.TELEGRAM_SECRET,
          allowed_updates: ["message"],
          drop_pending_updates: true,
        }),
      }
    );
    const json = await result.json();
    return new Response(JSON.stringify(json, null, 2), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
```

Key difference from aw-telegram-bot: dispatches to `telegram-bot.yml` (not `.lock.yml`).

**Step 4: Commit**

```bash
git add worker/
git commit -m "feat: add Cloudflare Worker webhook relay"
```

---

### Task 2: Python tool scripts (Telegram)

**Files:**
- Create: `.github/scripts/send_telegram_message.py`
- Create: `.github/scripts/send_telegram_photo.py`
- Create: `.github/scripts/send_telegram_video.py`
- Create: `.github/scripts/download_video.py`

**Step 1: Create `.github/scripts/send_telegram_message.py`**

```python
#!/usr/bin/env python3
"""Send a text message to Telegram.
Usage: python send_telegram_message.py <chat_id> <text>
Env: TELEGRAM_BOT_TOKEN
"""
import json, os, sys, urllib.request

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

if __name__ == "__main__":
    main()
```

**Step 2: Create `.github/scripts/send_telegram_photo.py`**

```python
#!/usr/bin/env python3
"""Send a photo to Telegram.
Usage: python send_telegram_photo.py <chat_id> <photo_path> [caption]
Env: TELEGRAM_BOT_TOKEN
"""
import json, os, sys, urllib.request

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: send_telegram_photo.py <chat_id> <photo_path> [caption]"}))
        sys.exit(1)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = sys.argv[1]
    photo_path = sys.argv[2]
    caption = sys.argv[3] if len(sys.argv) > 3 else ""
    boundary = "----TelegramUpload"
    body = b""
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n".encode()
    if caption:
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n{caption}\r\n".encode()
    with open(photo_path, "rb") as f:
        photo_data = f.read()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"photo\"; filename=\"image.png\"\r\nContent-Type: image/png\r\n\r\n".encode()
    body += photo_data
    body += f"\r\n--{boundary}--\r\n".encode()
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    req = urllib.request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    resp = urllib.request.urlopen(req)
    data = json.loads(resp.read())
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))

if __name__ == "__main__":
    main()
```

**Step 3: Create `.github/scripts/send_telegram_video.py`**

```python
#!/usr/bin/env python3
"""Send a video to Telegram.
Usage: python send_telegram_video.py <chat_id> <video_path> [caption]
Env: TELEGRAM_BOT_TOKEN
"""
import json, os, sys, urllib.request

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: send_telegram_video.py <chat_id> <video_path> [caption]"}))
        sys.exit(1)
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "")
    chat_id = sys.argv[1]
    video_path = sys.argv[2]
    caption = sys.argv[3] if len(sys.argv) > 3 else ""
    if not os.path.exists(video_path):
        print(json.dumps({"ok": False, "error": f"File not found: {video_path}"}))
        sys.exit(1)
    filesize = os.path.getsize(video_path)
    if filesize > 50 * 1024 * 1024:
        print(json.dumps({"ok": False, "error": f"File too large: {filesize} bytes (max 50MB)"}))
        sys.exit(1)
    boundary = "----TelegramUpload"
    body = b""
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat_id}\r\n".encode()
    if caption:
        body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\n{caption}\r\n".encode()
    with open(video_path, "rb") as f:
        video_data = f.read()
    filename = os.path.basename(video_path)
    ext = os.path.splitext(filename)[1].lower().lstrip(".")
    content_type = {"webm": "video/webm", "mkv": "video/x-matroska", "mp4": "video/mp4"}.get(ext, "video/mp4")
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"supports_streaming\"\r\n\r\ntrue\r\n".encode()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"video\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode()
    body += video_data
    body += f"\r\n--{boundary}--\r\n".encode()
    url = f"https://api.telegram.org/bot{token}/sendVideo"
    req = urllib.request.Request(url, data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    resp = urllib.request.urlopen(req, timeout=120)
    data = json.loads(resp.read())
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))

if __name__ == "__main__":
    main()
```

**Step 4: Create `.github/scripts/download_video.py`**

```python
#!/usr/bin/env python3
"""Download a video using yt-dlp.
Usage: python download_video.py <url>
"""
import json, os, subprocess, sys

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "No URL provided"}))
        sys.exit(1)
    url = sys.argv[1]
    # Install yt-dlp
    subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "yt-dlp"], stdout=subprocess.DEVNULL)
    output_dir = "/tmp/yt-dlp-output"
    os.makedirs(output_dir, exist_ok=True)
    output_template = os.path.join(output_dir, "%(id)s.%(ext)s")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "yt_dlp",
             "-f", "b[height<=360]/b",
             "-o", output_template,
             "--no-playlist", "--no-overwrites",
             "--restrict-filenames", "--print-json", url],
            capture_output=True, text=True, timeout=240)
    except subprocess.TimeoutExpired:
        print(json.dumps({"ok": False, "error": "Download timed out (240s)"}))
        sys.exit(1)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": (result.stderr.strip()[-500:] if result.stderr else "Unknown error")}))
        sys.exit(1)
    try:
        lines = result.stdout.strip().split("\n")
        info = json.loads(lines[-1])
    except (json.JSONDecodeError, IndexError):
        print(json.dumps({"ok": False, "error": "Failed to parse yt-dlp output"}))
        sys.exit(1)
    filepath = info.get("_filename", "")
    if not filepath or not os.path.exists(filepath):
        vid = info.get("id")
        ext = info.get("ext")
        if vid and ext:
            filepath = os.path.join(output_dir, f"{vid}.{ext}")
        if not filepath or not os.path.exists(filepath):
            print(json.dumps({"ok": False, "error": "Downloaded file not found"}))
            sys.exit(1)
    print(json.dumps({"ok": True, "file_path": filepath, "title": info.get("title", "Unknown"), "filesize": os.path.getsize(filepath)}))

if __name__ == "__main__":
    main()
```

**Step 5: Commit**

```bash
git add .github/scripts/send_telegram_message.py .github/scripts/send_telegram_photo.py .github/scripts/send_telegram_video.py .github/scripts/download_video.py
git commit -m "feat: add Telegram and video download tool scripts"
```

---

### Task 3: Python tool scripts (GitHub operations)

**Files:**
- Create: `.github/scripts/create_repo.py`
- Create: `.github/scripts/fork_repo.py`
- Create: `.github/scripts/setup_repo.py`
- Create: `.github/scripts/create_issues.py`
- Create: `.github/scripts/setup_secrets.py`
- Create: `.github/scripts/trigger_workflow.py`
- Create: `.github/scripts/post_comment.py`
- Create: `.github/scripts/manage_labels.py`

**Step 1: Create all GitHub operation scripts**

All scripts follow the same pattern: CLI args in, JSON out, uses `gh` CLI.

`.github/scripts/create_repo.py`:
```python
#!/usr/bin/env python3
"""Create a GitHub repository.
Usage: python create_repo.py <owner/name> <description>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: create_repo.py <owner/name> <description>"}))
        sys.exit(1)
    repo, description = sys.argv[1], sys.argv[2]
    result = subprocess.run(
        ["gh", "repo", "create", repo, "--public", "--description", description, "--clone=false"],
        capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "repo": repo, "url": result.stdout.strip()}))

if __name__ == "__main__":
    main()
```

`.github/scripts/fork_repo.py`:
```python
#!/usr/bin/env python3
"""Fork a GitHub repository.
Usage: python fork_repo.py <source_repo> <target_org> [fork_name]
Env: GH_TOKEN
"""
import json, subprocess, sys, time

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: fork_repo.py <source_repo> <target_org> [fork_name]"}))
        sys.exit(1)
    source_repo, target_org = sys.argv[1], sys.argv[2]
    fork_name = sys.argv[3] if len(sys.argv) > 3 else None
    cmd = ["gh", "repo", "fork", source_repo, "--org", target_org, "--clone=false"]
    if fork_name:
        cmd.extend(["--fork-name", fork_name])
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    name = fork_name if fork_name else source_repo.split("/")[-1]
    repo = f"{target_org}/{name}"
    for i in range(6):
        check = subprocess.run(["gh", "repo", "view", repo, "--json", "name"], capture_output=True, text=True)
        if check.returncode == 0:
            break
        time.sleep(5)
    subprocess.run(["gh", "api", f"repos/{repo}", "-X", "PATCH", "-f", "has_issues=true"], capture_output=True, text=True)
    print(json.dumps({"ok": True, "repo": repo, "url": f"https://github.com/{repo}"}))

if __name__ == "__main__":
    main()
```

`.github/scripts/setup_repo.py`:
```python
#!/usr/bin/env python3
"""Push initial files to a repository.
Usage: python setup_repo.py <owner/name> <json_files>
Env: GH_TOKEN
"""
import json, os, subprocess, sys, tempfile, time

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: setup_repo.py <owner/name> <json_files>"}))
        sys.exit(1)
    repo, files = sys.argv[1], json.loads(sys.argv[2])
    with tempfile.TemporaryDirectory() as tmpdir:
        for attempt in range(1, 4):
            result = subprocess.run(["gh", "repo", "clone", repo, tmpdir, "--", "--depth=1"], capture_output=True, text=True)
            if result.returncode == 0:
                break
            if attempt < 3:
                time.sleep(5)
        else:
            print(json.dumps({"ok": False, "error": f"Clone failed: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
        for f in files:
            filepath = os.path.join(tmpdir, f["path"])
            os.makedirs(os.path.dirname(filepath), exist_ok=True)
            with open(filepath, "w") as fh:
                fh.write(f["content"])
        token = os.environ.get("GH_TOKEN", "")
        subprocess.run(["git", "remote", "set-url", "origin", f"https://x-access-token:{token}@github.com/{repo}.git"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=tmpdir, capture_output=True)
        branch_result = subprocess.run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=tmpdir, capture_output=True, text=True)
        default_branch = branch_result.stdout.strip() or "main"
        subprocess.run(["git", "add", "-A"], cwd=tmpdir, capture_output=True)
        subprocess.run(["git", "commit", "-m", "Initial commit: project setup"], cwd=tmpdir, capture_output=True)
        result = subprocess.run(["git", "push", "origin", default_branch], cwd=tmpdir, capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Push failed: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
    result = subprocess.run(
        ["gh", "api", f"repos/{repo}/pages", "-X", "POST", "-f", "build_type=legacy", "-f", f"source[branch]={default_branch}", "-f", "source[path]=/"],
        capture_output=True, text=True)
    print(json.dumps({"ok": True, "files_pushed": len(files), "pages_enabled": result.returncode == 0}))

if __name__ == "__main__":
    main()
```

`.github/scripts/create_issues.py`:
```python
#!/usr/bin/env python3
"""Create multiple issues in a repository.
Usage: python create_issues.py <owner/name> <json_issues>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: create_issues.py <owner/name> <json_issues>"}))
        sys.exit(1)
    repo, issues = sys.argv[1], json.loads(sys.argv[2])
    numbers = []
    for label, desc, color in [
        ("copilot-task", "Managed by Copilot agent", "0E8A16"),
        ("agent-stuck", "Agent could not complete this issue", "D93F0B"),
        ("needs-human-review", "Needs human intervention", "FBCA04"),
    ]:
        subprocess.run(["gh", "label", "create", label, "--repo", repo, "--description", desc, "--color", color], capture_output=True, text=True)
    for issue in issues:
        result = subprocess.run(
            ["gh", "issue", "create", "--repo", repo, "--title", issue["title"], "--body", issue["body"], "--label", "copilot-task"],
            capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Failed to create '{issue['title']}': {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
        url = result.stdout.strip()
        numbers.append(int(url.rstrip("/").split("/")[-1]))
    print(json.dumps({"ok": True, "issues_created": len(numbers), "numbers": numbers}))

if __name__ == "__main__":
    main()
```

`.github/scripts/setup_secrets.py`:
```python
#!/usr/bin/env python3
"""Set secrets on a repository.
Usage: python setup_secrets.py <owner/name> <json_secrets>
Env: GH_TOKEN, COPILOT_TOKEN_VALUE, COPILOT_PAT_VALUE, NOTIFY_TOKEN_VALUE
"""
import json, os, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: setup_secrets.py <owner/name> <json_secrets>"}))
        sys.exit(1)
    repo, secrets = sys.argv[1], json.loads(sys.argv[2])
    for env_key, secret_name in [
        ("COPILOT_TOKEN_VALUE", "COPILOT_GITHUB_TOKEN"),
        ("COPILOT_PAT_VALUE", "COPILOT_PAT"),
        ("NOTIFY_TOKEN_VALUE", "NOTIFY_TOKEN"),
    ]:
        val = os.environ.get(env_key, "")
        if val:
            secrets.append({"name": secret_name, "value": val})
    for s in secrets:
        result = subprocess.run(["gh", "secret", "set", s["name"], "--repo", repo, "--body", s["value"]], capture_output=True, text=True)
        if result.returncode != 0:
            print(json.dumps({"ok": False, "error": f"Failed to set {s['name']}: {result.stderr.strip()[-300:]}"}))
            sys.exit(1)
    print(json.dumps({"ok": True, "secrets_set": len(secrets)}))

if __name__ == "__main__":
    main()
```

`.github/scripts/trigger_workflow.py`:
```python
#!/usr/bin/env python3
"""Trigger a workflow in a repository.
Usage: python trigger_workflow.py <owner/name> <workflow_file>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: trigger_workflow.py <owner/name> <workflow_file>"}))
        sys.exit(1)
    repo, workflow = sys.argv[1], sys.argv[2]
    result = subprocess.run(["gh", "workflow", "run", workflow, "--repo", repo], capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-500:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "repo": repo, "workflow": workflow}))

if __name__ == "__main__":
    main()
```

`.github/scripts/post_comment.py`:
```python
#!/usr/bin/env python3
"""Post a comment on an issue or PR.
Usage: python post_comment.py <owner/name> <number> <body>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 4:
        print(json.dumps({"ok": False, "error": "Usage: post_comment.py <owner/name> <number> <body>"}))
        sys.exit(1)
    repo, number, body = sys.argv[1], sys.argv[2], sys.argv[3]
    result = subprocess.run(["gh", "api", f"repos/{repo}/pulls/{number}"], capture_output=True, text=True)
    is_pr = result.returncode == 0
    if is_pr:
        cmd = ["gh", "pr", "comment", number, "--repo", repo, "--body", body]
        item_type = "pr"
    else:
        cmd = ["gh", "issue", "comment", number, "--repo", repo, "--body", body]
        item_type = "issue"
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-300:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "repo": repo, "number": int(number), "type": item_type}))

if __name__ == "__main__":
    main()
```

`.github/scripts/manage_labels.py`:
```python
#!/usr/bin/env python3
"""Add or remove labels on an issue or PR.
Usage: python manage_labels.py <owner/name> <number> <add|remove> <label>
Env: GH_TOKEN
"""
import json, subprocess, sys

def main():
    if len(sys.argv) < 5:
        print(json.dumps({"ok": False, "error": "Usage: manage_labels.py <owner/name> <number> <add|remove> <label>"}))
        sys.exit(1)
    repo, number, action, label = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    if action == "add":
        cmd = ["gh", "issue", "edit", number, "--repo", repo, "--add-label", label]
    elif action == "remove":
        cmd = ["gh", "issue", "edit", number, "--repo", repo, "--remove-label", label]
    else:
        print(json.dumps({"ok": False, "error": f"Unknown action: {action}"}))
        sys.exit(1)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(json.dumps({"ok": False, "error": result.stderr.strip()[-300:]}))
        sys.exit(1)
    print(json.dumps({"ok": True, "action": action, "label": label}))

if __name__ == "__main__":
    main()
```

**Step 2: Commit**

```bash
git add .github/scripts/create_repo.py .github/scripts/fork_repo.py .github/scripts/setup_repo.py .github/scripts/create_issues.py .github/scripts/setup_secrets.py .github/scripts/trigger_workflow.py .github/scripts/post_comment.py .github/scripts/manage_labels.py
git commit -m "feat: add GitHub operation tool scripts for App Factory"
```

---

### Task 4: AI prompt file

**Files:**
- Create: `prompt.md`

**Step 1: Create prompt.md**

This is the system prompt for Copilot CLI. Adapted from aw-telegram-bot's `telegram-bot.md` body, with tool references changed from safe-input names to shell commands (`python .github/scripts/<name>.py`).

```markdown
# Telegram Chatbot

You are a helpful, friendly AI assistant responding to a Telegram message.
You can generate images, research topics, translate text, download videos,
create app projects, trigger builds, and send messages to repos.

## Available Tools

You have the following tool scripts available. Run them with `python`:

### Telegram tools
- `python .github/scripts/send_telegram_message.py <chat_id> <text>` — Send text message
- `python .github/scripts/send_telegram_photo.py <chat_id> <photo_path> [caption]` — Send photo
- `python .github/scripts/send_telegram_video.py <chat_id> <video_path> [caption]` — Send video
- `python .github/scripts/download_video.py <url>` — Download video via yt-dlp

### GitHub tools (require GH_TOKEN env)
- `python .github/scripts/create_repo.py <owner/name> <description>` — Create repo
- `python .github/scripts/fork_repo.py <source_repo> <target_org> [fork_name]` — Fork repo
- `python .github/scripts/setup_repo.py <owner/name> <json_files>` — Push files to repo
- `python .github/scripts/create_issues.py <owner/name> <json_issues>` — Create issues
- `python .github/scripts/setup_secrets.py <owner/name> <json_secrets>` — Set secrets
- `python .github/scripts/trigger_workflow.py <owner/name> <workflow_file>` — Trigger workflow
- `python .github/scripts/post_comment.py <owner/name> <number> <body>` — Comment on issue/PR
- `python .github/scripts/manage_labels.py <owner/name> <number> <add|remove> <label>` — Manage labels

### MCP tools
- `generate_image` (via nanobanana MCP server) — Generate images with Gemini
- Tavily MCP server — Web search and content extraction

## Instructions

1. Check the message for a command prefix:
   - `/app <description>` → App Factory mode (build from scratch)
   - `/app fork:<owner/repo> <description>` → App Factory mode (fork and customize)
   - `/build <owner/repo>` → Build trigger mode
   - `/issue <owner/repo> <description>` → Create issue on existing repo
   - `/msg <owner/repo>#<number> <message>` → Message relay mode
   - `/research <topic>` → Research mode
   - `/draw <description>` → Image generation mode
   - `/translate <text>` → Translation mode
   - `/download <url>` → Video download mode
   - No prefix → Auto-judge: pick the best mode based on content
2. Execute the appropriate workflow below.
3. Always send exactly one response — a photo, a video, or a text message.

## Research workflow

Use this when the user asks to research, investigate, fact-check, or asks questions that need up-to-date information.

1. Use Tavily search to find information on the topic (use search_depth "advanced" for better results)
2. Use web-search to search from additional angles or keywords
3. Use web-fetch to read 2-3 of the most important source URLs in full
4. Synthesize all findings into a structured report:
   - **Summary**: 3-5 sentences overview
   - **Key findings**: bullet points with the most important facts
   - **Sources**: numbered list of URLs with brief descriptions
5. Send the report via `python .github/scripts/send_telegram_message.py`
6. If research fails or finds nothing useful, explain what was tried and suggest alternative queries

### Research guidelines

- Always cross-reference: don't rely on a single source
- Limit to 3-5 sources to keep response time reasonable
- Include source URLs so the user can verify
- Prefer recent sources when the topic is time-sensitive
- Write the report in the same language the user writes in

## Image generation workflow

Use this when the user asks to draw, generate, or create an image.

1. Call `generate_image` with a descriptive prompt (always in English for best results)
2. The tool returns a file path (e.g. `/tmp/nanobanana-output/image.png`)
3. Call `python .github/scripts/send_telegram_photo.py` with chat_id, photo_path, and caption
4. If generation fails, use `python .github/scripts/send_telegram_message.py` to explain the error

## Translation workflow

Use this when the user asks to translate text.

1. Detect the source language
2. Translate to the target language:
   - If the user specifies a target language, use that
   - If not specified: Chinese → English, English → Chinese, other → Chinese
3. Send the translation via `python .github/scripts/send_telegram_message.py`
4. Include the original text and the translation clearly formatted

## Video download workflow

Use this when the user asks to download a video from a URL.

1. Run `python .github/scripts/download_video.py <url>`
2. Check the JSON response:
   - If `ok` is `false` → send error message
   - If `ok` is `true` → check `filesize`
3. If filesize ≤ 50,000,000 (50MB):
   - Run `python .github/scripts/send_telegram_video.py` with chat_id, video_path, caption
4. If filesize > 50,000,000:
   - Send a text message explaining the video is too large for Telegram (max 50MB)

### Video download guidelines

- Supported sites: YouTube, Twitter/X, Instagram, and many more (any site yt-dlp supports)
- Videos are downloaded in 360p to keep file size manageable
- Only single videos are supported (no playlists)

## App Factory workflow

Use this when the user sends `/app <description>` to create a new app project.

### Phase 1: Evaluate feasibility

1. Analyze the user's description to understand what they want
2. Evaluate if it's feasible as an MVP
3. If NOT feasible, send a detailed explanation and stop

### Phase 2: Deep Research (Diverge)

**If the user specified `fork:<owner/repo>`:** skip search, go directly with that repo. Decision is "fork".

**Otherwise:**
1. Use web-search to find 2-3 similar open-source projects
2. Use web-fetch to read their README and file structure
3. Decide: Fork (≥60% match) / Build from scratch / Reference

### Phase 3: Technical decisions + Define "done"

**Tech simplicity rules:**
- Static over backend (GitHub Pages if possible)
- Native over framework (pure HTML/CSS/JS over React/Vue)
- localStorage over database
- Zero dependencies preferred

Determine: repo name, tech stack, deploy target.
Define acceptance criteria as numbered list of verifiable outcomes.

### Phase 4: Plan backwards (Converge)

Plan (in your mind, not output):
1. README.md, AGENTS.md
2. Issue list (2-5 issues, sequenced: foundation → implementation → polish/deploy)
3. Each issue: Objective, Context, Approach, Files, Acceptance Criteria, Validation

### Phase 5: Execute

Run scripts in order:
1. `python .github/scripts/create_repo.py` or `python .github/scripts/fork_repo.py`
2. `python .github/scripts/setup_repo.py` with all files
3. `python .github/scripts/create_issues.py` with planned issues
4. `python .github/scripts/setup_secrets.py` with `[]`
5. `python .github/scripts/send_telegram_message.py` with summary

### App Factory guidelines

- Repo names: descriptive, short, hyphenated
- README in user's language (Traditional Chinese)
- AGENTS.md and issues in English
- Target 2-5 issues
- Each issue completable within 55-minute timeout

## Build trigger workflow

Use this when the user sends `/build <owner/repo>`.

1. Parse the repo name
2. Run `python .github/scripts/trigger_workflow.py <repo> implement.yml`
3. Send confirmation: "🚀 已觸發 <repo> 開發流程，可到 https://github.com/<repo>/actions 查看進度"

## Issue creation workflow

Use this when the user sends `/issue <owner/repo> <description>`.

1. Parse command: extract repo and description
2. Research the existing repo (read AGENTS.md, README.md via web-fetch)
3. Write structured issue body (Objective/Context/Approach/Files/AC/Validation)
4. Run `python .github/scripts/create_issues.py` with the issue
5. Send confirmation: "📋 已在 <repo> 建立 issue #N: <title>"

## Message relay workflow

Use this when the user sends `/msg <owner/repo>#<number> <message>`.

1. Parse: repo, number, message
2. Run `python .github/scripts/post_comment.py <repo> <number> "📝 User instruction:\n\n<message>"`
3. Check for `agent-stuck` or `needs-human-review` label → remove and trigger workflow
4. Send confirmation: "📝 已將指示傳達給 <repo> #<number>"

## General guidelines

- Always respond in Traditional Chinese (繁體中文) unless the user writes in another language
- Keep text responses under 4096 characters (Telegram limit)
- For image requests, write detailed prompts in English for better quality
- If you don't know something, say so honestly
- When auto-judging mode: if unsure, default to a helpful text reply
- When auto-judging mode: if the user describes an app or tool idea, route to `/app` mode
```

**Step 2: Commit**

```bash
git add prompt.md
git commit -m "feat: add AI system prompt for Copilot CLI agent"
```

---

### Task 5: Main GitHub Actions workflow

**Files:**
- Create: `.github/workflows/telegram-bot.yml`

**Step 1: Create `.github/workflows/telegram-bot.yml`**

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
        required: false

concurrency:
  group: telegram-bot-${{ github.run_id }}
  cancel-in-progress: false

jobs:
  agent:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - name: Checkout repository
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Install GitHub Copilot CLI
        run: npm install -g @github/copilot

      - name: Setup MCP config
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          TAVILY_API_KEY: ${{ secrets.TAVILY_API_KEY }}
        run: |
          mkdir -p ~/.copilot
          cat > ~/.copilot/mcp-config.json << EOF
          {
            "mcpServers": {
              "nanobanana": {
                "type": "local",
                "command": "docker",
                "args": [
                  "run", "-i", "--rm",
                  "-v", "/tmp:/tmp:rw",
                  "-e", "NANOBANANA_GEMINI_API_KEY=${GEMINI_API_KEY}",
                  "-e", "NANOBANANA_OUTPUT_DIR=/tmp/nanobanana-output",
                  "-e", "NANOBANANA_MODEL=gemini-3-pro-image-preview",
                  "-e", "NANOBANANA_FALLBACK_MODELS=gemini-3.1-flash-image-preview,gemini-2.5-flash-image",
                  "-e", "NANOBANANA_TIMEOUT=120",
                  "-e", "NANOBANANA_DEBUG=1",
                  "ghcr.io/astral-sh/uv:python3.12-alpine",
                  "uvx", "nanobanana-py"
                ],
                "tools": ["generate_image"]
              },
              "tavily": {
                "type": "http",
                "url": "https://mcp.tavily.com/mcp/?tavilyApiKey=${TAVILY_API_KEY}",
                "tools": ["*"]
              }
            }
          }
          EOF

      - name: Configure Git
        run: |
          git config --global user.email "github-actions[bot]@users.noreply.github.com"
          git config --global user.name "github-actions[bot]"

      - name: Run Copilot agent
        env:
          COPILOT_GITHUB_TOKEN: ${{ secrets.PERSONAL_ACCESS_TOKEN }}
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
          GH_TOKEN: ${{ secrets.FACTORY_PAT }}
          COPILOT_PAT_VALUE: ${{ secrets.COPILOT_PAT }}
          COPILOT_TOKEN_VALUE: ${{ secrets.CHILD_COPILOT_TOKEN }}
          NOTIFY_TOKEN_VALUE: ${{ secrets.NOTIFY_TOKEN }}
        run: |
          CHAT_ID="${{ inputs.chat_id }}"
          USERNAME="${{ inputs.username }}"
          TEXT="${{ inputs.text }}"

          PROMPT=$(cat prompt.md)
          PROMPT=$(printf "%s\n\n## Current Message\n\n- **Chat ID**: %s\n- **Username**: %s\n- **Message**: %s" \
            "$PROMPT" "$CHAT_ID" "$USERNAME" "$TEXT")

          copilot --autopilot --yolo --max-autopilot-continues 30 -p "$PROMPT"
```

**Step 2: Commit**

```bash
git add .github/workflows/telegram-bot.yml
git commit -m "feat: add main Telegram chatbot workflow using Copilot CLI"
```

---

### Task 6: Notification callback workflow

**Files:**
- Create: `.github/workflows/notify.yml`

**Step 1: Create `.github/workflows/notify.yml`**

```yaml
name: Send Telegram Notification

on:
  workflow_dispatch:
    inputs:
      chat_id:
        description: "Telegram chat ID"
        required: true
      text:
        description: "Notification text"
        required: true

jobs:
  notify:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - name: Verify caller
        env:
          ACTOR: ${{ github.actor }}
        run: |
          if [[ "$ACTOR" != "yazelin" && \
                "$ACTOR" != "github-actions[bot]" ]]; then
            echo "::error::Unauthorized caller: $ACTOR"
            exit 1
          fi

      - name: Send Telegram message
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          CHAT_ID: ${{ inputs.chat_id }}
          TEXT: ${{ inputs.text }}
        run: |
          RESPONSE=$(curl -s -X POST \
            "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H "Content-Type: application/json" \
            -d "{\"chat_id\": \"${CHAT_ID}\", \"text\": $(echo "$TEXT" | jq -Rs .)}")
          echo "$RESPONSE"
          OK=$(echo "$RESPONSE" | jq -r '.ok')
          if [ "$OK" != "true" ]; then
            echo "::error::Telegram API error: $(echo "$RESPONSE" | jq -r '.description // "unknown"')"
            exit 1
          fi
```

**Step 2: Commit**

```bash
git add .github/workflows/notify.yml
git commit -m "feat: add notification callback workflow"
```

---

### Task 7: README and initial git setup

**Files:**
- Create: `README.md`

**Step 1: Initialize git repo**

```bash
cd /home/ct/telegram-copilot-bot
git init
```

**Step 2: Create README.md**

```markdown
# telegram-copilot-bot

Telegram chatbot powered by GitHub Copilot CLI, running on GitHub Actions.

Standalone version — no gh-aw dependency. Uses `npm install -g @github/copilot` directly.

## Features

- 💬 AI chat (auto-judge mode)
- 🎨 Image generation (`/draw`) via Nanobanana + Gemini
- 🔍 Research (`/research`) via Tavily
- 🌐 Translation (`/translate`)
- 📹 Video download (`/download`) via yt-dlp
- 🏭 App Factory (`/app`) — create repos, issues, trigger builds
- 🔨 Build trigger (`/build`)
- 📋 Issue creation (`/issue`)
- 📝 Message relay (`/msg`)

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
```

**Step 3: Create initial commit with all files**

```bash
git add -A
git commit -m "feat: initial telegram-copilot-bot scaffold"
```

---

### Task 8: Create GitHub repo and push

**Step 1: Create remote repo**

```bash
gh repo create yazelin/telegram-copilot-bot --public --description "Telegram chatbot powered by Copilot CLI on GitHub Actions (no gh-aw)" --source /home/ct/telegram-copilot-bot
```

**Step 2: Push**

```bash
cd /home/ct/telegram-copilot-bot
git push -u origin main
```

---

## Execution Order

Tasks 1-6 can be done as a single batch (all file creation). Task 7 wraps them into a git repo. Task 8 pushes to GitHub.

Recommended: create all files first (Tasks 1-6), then do Task 7 (git init + single initial commit), then Task 8 (push).

## Post-Setup Checklist

After pushing:
1. Set all repository secrets on GitHub
2. Deploy Cloudflare Worker with `wrangler deploy`
3. Set worker secrets with `wrangler secret put`
4. Register Telegram webhook
5. Test with a simple message
6. Test `/draw` command
7. Test `/research` command
