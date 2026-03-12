# telegram-copilot-bot

透過 GitHub Copilot CLI 驅動的個人 Telegram 聊天機器人。除了基本對話，它更是一座 **App Factory** — 只需一則 Telegram 訊息，就能自動建立、開發並部署網頁應用程式。

本專案是 [aw-telegram-bot](https://github.com/yazelin/aw-telegram-bot) 的**無 gh-aw 版本**。原版使用 [gh-aw](https://github.com/github/gh-aw)（GitHub Agentic Workflows）框架，本版本移除該依賴，直接使用 `npm install -g @github/copilot` 安裝 Copilot CLI。功能完全相同。

**Dashboard（純前端，透過 Worker API 讀取 KV 資料）：** https://yazelin.github.io/telegram-copilot-bot/dashboard/

## 與原版 (aw-telegram-bot) 的比較

| 項目 | aw-telegram-bot（原版） | telegram-copilot-bot（本版） |
|------|------------------------|----------------------------|
| AI 引擎安裝 | `gh-aw`（GitHub Agentic Workflows 框架） | `npm install -g @github/copilot`（直接安裝） |
| Prompt 格式 | `telegram-bot.md` → `gh aw compile` 編譯成 `.lock.yml` | `prompt.md` 直接使用，不需編譯 |
| 工具腳本 | Safe-Inputs（gh-aw 原生機制） | Python 腳本（`.github/scripts/`） |
| 圖片生成 | Nanobanana MCP Server（透過 gh-aw MCP 整合） | 直接呼叫 Gemini REST API（`generate_image.py`） |
| 網路搜尋 | Tavily MCP Server | Tavily MCP Server（相同） |
| 影片下載 | yt-dlp | yt-dlp（相同） |
| App Factory | 事件驅動開發鏈 | 事件驅動開發鏈（相同） |
| 子 Repo 結構 | implement.yml + review.yml + skills | 相同 |

## 版本歷史

| 版本 | Tag | 說明 |
|------|-----|------|
| v3.0（目前） | `v3.0` | 記憶功能 + 純 KV Dashboard + sync-repos 同步 |
| v2.0 | `v2.0` | Shell 前處理 + Gemini Flash API + 一鍵設定 + Graceful degradation |
| v1.0 | `v1.0-before-shell-routing` | 所有訊息都經過 Copilot CLI 處理 |

> **v3.0 改動重點**：Cloudflare Worker 新增 KV 記憶系統，儲存對話歷史、Repo 元資料與統計數字。所有機器人回覆（含 Copilot CLI 路由、`notify.yml` 子 Repo 通知）均自動記錄至 KV。新增純前端 Dashboard（GitHub Pages），透過 Worker API 讀取 KV 資料（Dashboard 本身不呼叫 GitHub API）。新增 `/api/sync-repos` 端點自動同步 aw-apps 組織的 Repo 清單與 Issue 進度（伺服器端透過 GitHub API 取得）。新增 `/reset` 與 `/setpref` 指令可直接在 Worker 處理，無需等 Actions。

> **v2.0 改動重點**：新增 `route_command.sh` 和 `gemini_chat.py`，簡單命令（`/build`、`/msg`、`/download`、`/draw`、`/translate`、一般聊天）由 shell 腳本 + Gemini Flash API 直接處理，不消耗 Premium Request。只有 `/app`、`/issue`、`/research` 和 Gemini 無法處理的訊息才呼叫 Copilot CLI。新增 `setup.sh` 一鍵安裝精靈、Secret 缺失時的友善提示（Graceful degradation）、動態 repository owner 支援。

## 運作方式

```
你 (Telegram) → Cloudflare Worker → GitHub Actions
                     │                    │
                  KV 記憶            route_command.sh 解析命令
                  （歷史 / Repo）          │
                                ┌──────────┼──────────┐
                                ▼          ▼          ▼
                          Shell 直接   Gemini Flash  Copilot CLI
                          /build,msg   /draw,/trans  /app,/issue
                          /download    一般聊天       /research
                          (0 Premium)  (0 Premium)   (1 Premium)
```

1. 傳送訊息給 Telegram 機器人
2. Cloudflare Worker 接收 Webhook，驗證使用者身份，將訊息寫入 KV 歷史，轉發到 GitHub Actions
3. `route_command.sh` 解析命令前綴，決定路由：
   - **Shell 直接處理**：`/build`、`/msg`、`/download` → 呼叫對應 Python 腳本（0 cost）
   - **Gemini Flash API**：`/draw`、`/translate`、一般聊天 → `gemini_chat.py`（0 Premium Request）
   - **Copilot CLI**：`/app`、`/issue`、`/research`、Gemini 無法處理的訊息（1 Premium Request）
4. Actions 完成後透過 `/api/callback` 回傳結果，Worker 寫入 KV（機器人回覆、Repo 元資料、統計）

## 指令列表

| 指令 | 說明 | 範例 |
|------|------|------|
| `/app <描述>` | 從零開始建立新的網頁應用 | `/app 番茄鐘計時器網頁` |
| `/app fork:<owner/repo> <描述>` | Fork 現有專案並客製化 | `/app fork:user/repo 加上深色主題` |
| `/build <owner/repo>` | 觸發指定 Repo 的實作流程 | `/build aw-apps/my-app` |
| `/issue <owner/repo> <描述>` | 在指定 Repo 建立結構化 Issue | `/issue aw-apps/my-app 修正 RWD 版面` |
| `/msg <owner/repo>#<N> <文字>` | 在 Issue 或 PR 上留言 | `/msg aw-apps/my-app#3 請加上動畫` |
| `/research <主題>` | 網路研究（多來源搜尋） | `/research React vs Vue 2026` |
| `/draw <描述>` | AI 圖片生成（Gemini） | `/draw 一隻柴犬在太空` |
| `/translate <文字>` | 翻譯文字 | `/translate Hello World` |
| `/download <網址>` | 下載 YouTube、X 等平台影片 | `/download https://youtu.be/...` |
| `/reset` | 清除所有對話記憶，重新開始 | `/reset` |
| `/setpref <key> <value>` | 設定偏好（lang / tech） | `/setpref lang 繁體中文` |
| *（無前綴）* | 自動判斷：聊天、翻譯或選擇最佳模式 | `幫我翻譯這段英文` |

## 系統架構

### 元件總覽

```
┌─────────────┐  webhook  ┌──────────────────┐  dispatch  ┌───────────────────────┐
│  Telegram    │ ────────→ │  Cloudflare       │ ─────────→ │  GitHub Actions        │
│  （使用者）   │ ←──────── │  Worker           │            │  （父 Repo）            │
│              │  機器人回覆 │  - 身份驗證        │            │                        │
└─────────────┘            │  - 白名單過濾      │            │  route_command.sh      │
                           │  - KV 記憶         │            │  Copilot CLI           │
                           │  - API 端點        │            │  + MCP (Tavily)        │
                           └─────────┬──────────┘            │  + Python 腳本         │
                                     │ /api/callback          └──────────┬────────────┘
                                     │ (Actions 回傳)                    │
                              KV Namespace                 ┌─────────────┼─────────────┐
                         ┌──────────────────┐              ▼             ▼             ▼
                         │  BOT_MEMORY      │       ┌──────────┐  ┌──────────┐  ┌──────────┐
                         │  chat:* 歷史     │       │ aw-apps/ │  │ aw-apps/ │  │ aw-apps/ │
                         │  repo:* 元資料   │       │  app-1   │  │  app-2   │  │  fork-1  │
                         │  stats 統計      │       │ (子Repo) │  │ (子Repo) │  │  (Fork)  │
                         └─────────┬────────┘       └──────────┘  └──────────┘  └──────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │  Dashboard (GitHub Pages)    │
                    │  /dashboard/                 │
                    │  純前端，讀 Worker API        │
                    │  前端不直接呼叫 GitHub API    │
                    └─────────────────────────────┘
```

### GitHub 組織與 Repo

| Repo | 角色 | 說明 |
|------|------|------|
| `yazelin/telegram-copilot-bot` | **父 Repo** | 託管機器人工作流程、App Factory 範本與 Python 腳本 |
| `aw-apps/*` | **子 Repo** | 自動建立的網頁應用 Repo，各自擁有獨立 CI/CD |

### Worker API 端點

| 端點 | 方法 | 認證 | 說明 |
|------|------|------|------|
| `/webhook` | POST | Telegram Secret | 接收 Telegram Webhook |
| `/register?token=<secret>` | GET | TELEGRAM_SECRET | 註冊 Telegram Webhook |
| `/api/callback` | POST | X-Secret: CALLBACK_TOKEN | 接收 GitHub Actions 回傳（bot_reply / repo_created / repo_activity / set_prefs），repo 類型會透過 GitHub API 取得 Issue 進度 |
| `/api/stats` | GET | 無 | 取得統計（totalMessages, totalApps, totalDraws, totalBuilds） |
| `/api/history/:chatId` | GET | 無 | 取得對話歷史 |
| `/api/repos` | GET | 無 | 取得所有 Repo 元資料 |
| `/api/prefs/:chatId` | GET | 無 | 取得使用者偏好設定 |
| `/api/reset/:chatId` | POST | X-Secret: CALLBACK_TOKEN | 清除指定 Chat 的所有 KV 記錄 |
| `/api/sync-repos` | POST | X-Secret: CALLBACK_TOKEN | 同步 APPS_ORG 的 Repo 至 KV（透過 GitHub API 取得 Issue 進度、Fork 資訊） |

## 環境變數與 Secret

### Cloudflare Worker

透過 `wrangler secret put` 或 `wrangler.toml` 設定。

| 變數 | 類型 | 用途 |
|------|------|------|
| `TELEGRAM_BOT_TOKEN` | Secret | Telegram Bot API Token |
| `TELEGRAM_SECRET` | Secret | Webhook 簽名驗證 |
| `GITHUB_TOKEN` | Secret | 觸發父 Repo 工作流程（需 `actions:write`） |
| `GITHUB_OWNER` | Secret | 父 Repo 擁有者（例如 `yazelin`） |
| `GITHUB_REPO` | Secret | 父 Repo 名稱（例如 `telegram-copilot-bot`） |
| `CALLBACK_TOKEN` | Secret | 保護 `/api/callback` 與 `/api/sync-repos`（`openssl rand -hex 20`） |
| `APPS_ORG` | Secret | 子 Repo 所在的 GitHub 組織（例如 `aw-apps`） |
| `ALLOWED_USERS` | Var | 允許的 Telegram User ID（逗號分隔） |
| `ALLOWED_CHATS` | Var | 允許的 Telegram Chat ID（逗號分隔） |

> **注意**：`GITHUB_OWNER` 為**父 Repo 擁有者**（觸發 Actions 用），`APPS_ORG` 為**子 Repo 組織**（sync-repos 與 issue count 用）。兩者必須分開設定。

### 父 Repo（GitHub Actions Secret）

| Secret | 用途 | Token 類型 |
|--------|------|------------|
| `TELEGRAM_BOT_TOKEN` | 傳送 Telegram 訊息 | Telegram Bot API Token |
| `CALLBACK_URL` | Worker callback 端點 URL | 純文字 URL |
| `CALLBACK_TOKEN` | 驗證 callback 請求 | 與 Worker 相同值 |
| `GEMINI_API_KEY` | 圖片生成（Google Gemini） | Google AI API Key |
| `TAVILY_API_KEY` | 網路搜尋（Tavily MCP） | Tavily API Key |
| `FACTORY_PAT` | 在 `aw-apps` 組織建立 Repo、設定 Secret | Fine-grained PAT |
| `FORK_TOKEN` | Fork 外部 Repo 至 `aw-apps` 組織 | Classic PAT（需 `public_repo`） |
| `COPILOT_PAT` | 子 Repo 的 Git push、PR 管理 | Fine-grained PAT |
| `CHILD_COPILOT_TOKEN` | 傳遞至子 Repo 的 Copilot CLI Token | Copilot CLI Token |
| `NOTIFY_TOKEN` | 子 Repo 回呼通知 | Fine-grained PAT |

### 子 Repo（自動傳遞）

由 `setup_secrets.py` 自動從父 Repo 設定，**不需手動設定**。

| Secret（子 Repo） | 來源（父 Repo） | 用途 |
|-------------------|----------------|------|
| `COPILOT_GITHUB_TOKEN` | `CHILD_COPILOT_TOKEN` | Copilot CLI 認證 |
| `COPILOT_PAT` | `COPILOT_PAT` | Git push、PR 管理 |
| `NOTIFY_TOKEN` | `NOTIFY_TOKEN` | 完成/失敗時回呼父 Repo |

### Secret 流向圖

```
Cloudflare Worker                     父 Repo (telegram-copilot-bot)          子 Repo (aw-apps/*)
┌────────────────────┐               ┌────────────────────────┐              ┌─────────────────────┐
│ TELEGRAM_BOT_TOKEN │               │ TELEGRAM_BOT_TOKEN     │              │                     │
│ TELEGRAM_SECRET    │               │ CALLBACK_URL           │              │                     │
│ GITHUB_TOKEN ──────┼── 觸發 ──────→│ CALLBACK_TOKEN         │              │                     │
│ GITHUB_OWNER       │               │ GEMINI_API_KEY         │              │                     │
│ GITHUB_REPO        │               │ TAVILY_API_KEY         │              │                     │
│ CALLBACK_TOKEN     │←── callback ──│ FACTORY_PAT ───────────┼── 建 Repo ──→│                     │
│ APPS_ORG           │               │ FORK_TOKEN ────────────┼── Fork ─────→│                     │
│ ALLOWED_USERS      │               │ CHILD_COPILOT_TOKEN ───┼── 傳遞 ─────→│ COPILOT_GITHUB_TOKEN│
│ ALLOWED_CHATS      │               │ COPILOT_PAT ───────────┼── 傳遞 ─────→│ COPILOT_PAT         │
└────────────────────┘               │ NOTIFY_TOKEN ──────────┼── 傳遞 ─────→│ NOTIFY_TOKEN ───────┼── 回呼
                                     └────────────────────────┘              └─────────────────────┘
```

## Dashboard

部署於 GitHub Pages，網址：`https://<owner>.github.io/<repo>/dashboard/`

### 功能

- **統計卡片**：訊息總數、App 數、繪圖數、Build 數（從 KV 讀取）
- **Repo 卡片**：名稱連結、描述、Issue 進度條（closed / total）、最後活動時間、互動類型徽章（created / build / msg）、Repo / Actions / Site 三個連結、Fork 來源標記
- **對話歷史**：Telegram 風格氣泡，使用者（右對齊藍色）、機器人（左對齊白色）、命令（等寬字型灰底）
- **設定面板**：滑入式側欄，可修改 Worker API URL 與 Chat ID，儲存於 localStorage
- **前端零 GitHub API 呼叫**：所有資料均從 Worker `/api/stats`、`/api/history/:chatId`、`/api/repos` 讀取（但 Worker 的 `/api/sync-repos` 端點會在伺服器端呼叫 GitHub API 同步資料）

### 同步 Repo 資料

首次部署或新增 Repo 後，執行以下指令將 aw-apps 組織的 Repo 同步至 KV：

```bash
curl -X POST https://<your-worker>.workers.dev/api/sync-repos \
  -H "X-Secret: <CALLBACK_TOKEN>"
```

sync-repos 會（伺服器端透過 GitHub API）：
1. 從 `APPS_ORG` 組織讀取所有 Repo（若非組織則自動 fallback 至用戶帳號）
2. 取得各 Repo 的 Issue 進度（open / closed）與 Fork 來源
3. 建立或更新 KV 中的 `repo:*` 記錄（保留既有的互動紀錄）
4. 刪除在 GitHub 上已不存在的 KV 記錄

## App Factory 流水線

### 事件驅動開發鏈

```
Issue 建立（copilot-task 標籤）
        │
        ▼
  ┌─────────────┐    PR 開啟      ┌─────────────┐
  │  implement   │ ─────────────→ │   review     │
  │  工作流程     │                │   工作流程    │
  │              │                │              │
  │ Copilot CLI  │ ← 要求修改 ─── │ Copilot CLI  │
  │ --autopilot  │                │ + Playwright │
  │ --yolo       │                │   瀏覽器測試  │
  └──────────────┘                └──────┬───────┘
                                         │
                                    PR 合併
                                         │
                                         ▼
                                  觸發下一個 Issue
                                 （循環直到全部完成）
                                         │
                                         ▼
                                   全部完成
                                   透過 Telegram 通知
```

每個循環：**實作 → PR → 審查（+ Playwright 測試）→ 合併 → 下一個 Issue**

若審查發現問題 → 要求修改 → 實作修正 → 再次審查（最多 3 輪）

### 品質防護機制

- **靜態匯入檢查**：推送前掃描 bare module imports（必須使用 CDN 或相對路徑）
- **Playwright 瀏覽器測試**：啟動 HTTP 伺服器、開啟頁面、檢查 Console 錯誤
- **審查上限**：最多 3 輪審查，超過則升級為人工處理（`needs-human-review` 標籤）
- **卡住偵測**：實作失敗時加上 `agent-stuck` 標籤 + Telegram 通知

## 專案結構

```
telegram-copilot-bot/
├── .github/
│   ├── workflows/
│   │   ├── telegram-bot.yml         # 主要工作流程（路由 + Copilot CLI）
│   │   └── notify.yml               # Telegram 通知回呼
│   ├── scripts/
│   │   ├── route_command.sh         # 命令路由器（Shell 前處理）
│   │   ├── gemini_chat.py           # Gemini Flash 文字 API（聊天/翻譯）
│   │   ├── generate_image.py        # Gemini 圖片生成（REST API）
│   │   ├── download_video.py        # yt-dlp 影片下載
│   │   ├── create_repo.py           # 建立 GitHub Repo
│   │   ├── fork_repo.py             # Fork 外部 Repo
│   │   ├── setup_repo.py            # 推送初始檔案 + 啟用 Pages
│   │   ├── create_issues.py         # 批次建立 Issue
│   │   ├── setup_secrets.py         # 設定 Repo Secret
│   │   ├── trigger_workflow.py      # 觸發子 Repo 工作流程
│   │   ├── post_comment.py          # Issue/PR 留言
│   │   ├── manage_labels.py         # 標籤管理
│   │   ├── send_telegram_message.py # 傳送文字
│   │   ├── send_telegram_photo.py   # 傳送圖片
│   │   └── send_telegram_video.py   # 傳送影片
│   └── templates/
│       ├── workflows/
│       │   ├── implement.yml        # 子 Repo 實作範本
│       │   └── review.yml           # 子 Repo 審查範本
│       └── skills/
│           ├── issue-workflow-SKILL.md
│           ├── code-standards-SKILL.md
│           ├── frontend-design-SKILL.md
│           ├── testing-SKILL.md
│           └── deploy-pages-SKILL.md
├── dashboard/                       # Dashboard 前端（GitHub Pages）
│   ├── index.html
│   ├── style.css
│   └── app.js
├── worker/                          # Cloudflare Worker
│   ├── src/index.js                 # Webhook + KV 記憶 + API 端點
│   └── wrangler.toml
├── prompt.md                        # Copilot CLI 主要 Prompt
└── README.md
```

## 設定方式

### 前置需求

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)（Cloudflare Workers）
- [Telegram Bot](https://core.telegram.org/bots#botfather)（透過 @BotFather 建立）
- GitHub Copilot 訂閱
- 用於子 Repo 的 GitHub 組織（例如 `aw-apps`）

### 1. 部署 Cloudflare Worker

```bash
cd worker
npm install

# 設定 secrets
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_SECRET        # openssl rand -hex 20
npx wrangler secret put GITHUB_TOKEN           # 父 Repo actions:write PAT
npx wrangler secret put GITHUB_OWNER           # 父 Repo 擁有者（如 yazelin）
npx wrangler secret put GITHUB_REPO            # 父 Repo 名稱
npx wrangler secret put CALLBACK_TOKEN         # openssl rand -hex 20
npx wrangler secret put APPS_ORG               # 子 Repo 組織（如 aw-apps）

npm run deploy
```

在 `wrangler.toml` 中設定白名單：
```toml
[vars]
ALLOWED_USERS = "你的_Telegram_User_ID"
ALLOWED_CHATS = ""
```

### 2. 設定 GitHub Repo Secret

```bash
gh secret set TELEGRAM_BOT_TOKEN
gh secret set CALLBACK_URL          # https://<your-worker>.workers.dev/api/callback
gh secret set CALLBACK_TOKEN        # 與 Worker 相同值
gh secret set GEMINI_API_KEY
gh secret set TAVILY_API_KEY
gh secret set FACTORY_PAT
gh secret set FORK_TOKEN
gh secret set CHILD_COPILOT_TOKEN
gh secret set COPILOT_PAT
gh secret set NOTIFY_TOKEN
```

### 3. 註冊 Telegram Webhook

```
https://your-worker.workers.dev/register?token=YOUR_TELEGRAM_SECRET
```

### 4. 同步 Repo 資料至 Dashboard

```bash
curl -X POST https://your-worker.workers.dev/api/sync-repos \
  -H "X-Secret: YOUR_CALLBACK_TOKEN"
```

### 5. 測試

傳送訊息給你的 Telegram 機器人，然後開啟 Dashboard 確認資料已同步！

## 相關文章

- [telegram-copilot-bot：不用 gh-aw 的輕量版 Telegram AI 機器人](https://yazelin.github.io/ai/2026/03/05/telegram-copilot-bot-no-ghaw.html)
- [aw-telegram-bot 系列目錄（原版）](https://yazelin.github.io/index/2026/03/04/aw-telegram-bot-series-index.html)

## 授權

MIT
