// --- KV Helpers ---

const MAX_HISTORY = 20;
const MAX_HISTORY_JSON_LENGTH = 2000;

async function appendHistory(kv, chatId, entry) {
  // Use separate keys for user and bot to avoid read-modify-write race
  const suffix = entry.role === "bot" ? "bot" : "user";
  const key = `chat:${chatId}:${suffix}`;
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
  // Merge user and bot histories, sort by timestamp
  let user = [], bot = [];
  try {
    const u = await kv.get(`chat:${chatId}:user`, "json");
    if (Array.isArray(u)) user = u;
  } catch {}
  try {
    const b = await kv.get(`chat:${chatId}:bot`, "json");
    if (Array.isArray(b)) bot = b;
  } catch {}
  const merged = [...user, ...bot].sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  // Trim to max
  return merged.length > MAX_HISTORY * 2
    ? merged.slice(-MAX_HISTORY * 2)
    : merged;
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

// --- CORS & Response Helpers ---

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

// --- Main Router ---

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

// --- Telegram Send Helper ---

async function sendTelegram(token, chatId, text) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

// --- Webhook Handler ---

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
    const text = msg.text.trim();

    // Handle /setpref directly in Worker (no GitHub dispatch needed)
    const prefMatch = text.match(/^\/setpref\s+(lang|tech)\s+(.+)/i);
    if (prefMatch) {
      const keyMap = { lang: "language", tech: "techStack" };
      const jsonKey = keyMap[prefMatch[1].toLowerCase()];
      const value = prefMatch[2].trim();
      const existing = await getPrefs(env.BOT_MEMORY, chatId);
      await env.BOT_MEMORY.put(`chat:${chatId}:prefs`, JSON.stringify({ ...existing, [jsonKey]: value }));
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, `✅ 已設定 ${prefMatch[1]} = ${value}`);
      return;
    }
    if (text === "/setpref") {
      await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId,
        "用法: /setpref <key> <value>\n可用 key: lang, tech\n範例: /setpref lang 繁體中文\n範例: /setpref tech React, Node.js");
      return;
    }

    // Store user message in KV
    await appendHistory(env.BOT_MEMORY, chatId, {
      role: "user",
      text: msg.text,
      timestamp: new Date().toISOString(),
    });

    // Increment stats
    await incrementStats(env.BOT_MEMORY, "totalMessages");
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

// --- Callback Handler ---

async function handleCallback(request, env) {
  const secret = request.headers.get("X-Secret");
  if (secret !== env.CALLBACK_TOKEN) {
    return jsonResponse({ error: "Unauthorized" }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Bad Request" }, 400);
  }

  const { type, chat_id, text, timestamp, repo, command, description, prefs } = body;

  if (type === "bot_reply" && chat_id && text) {
    await appendHistory(env.BOT_MEMORY, chat_id, {
      role: "bot",
      text: text.slice(0, 500),
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

  if (type === "set_prefs" && chat_id && prefs) {
    const existing = await getPrefs(env.BOT_MEMORY, chat_id);
    const merged = { ...existing, ...prefs };
    await env.BOT_MEMORY.put(`chat:${chat_id}:prefs`, JSON.stringify(merged));
  }

  return jsonResponse({ ok: true });
}

// --- GitHub Dispatch ---

async function dispatchToGitHub(update, env, history, prefs) {
  const msg = update.message;
  const workflowFile = "telegram-bot.yml";

  // Exclude current message from history (it's already in `text`)
  const historyJson = truncateHistoryForDispatch(history.slice(0, -1));
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

// --- Webhook Registration ---

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
