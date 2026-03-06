#!/usr/bin/env python3
"""Send a text message to Telegram and record it in Worker KV via callback.
Usage: python send_telegram_message.py <chat_id> <text>
Env: TELEGRAM_BOT_TOKEN, CALLBACK_URL (optional), CALLBACK_TOKEN (optional)
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone

def post_callback(chat_id, text):
    callback_url = os.environ.get("CALLBACK_URL", "")
    callback_token = os.environ.get("CALLBACK_TOKEN", "")
    if not callback_url or not callback_token:
        return
    payload = json.dumps({
        "type": "bot_reply",
        "chat_id": chat_id,
        "text": text[:500],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }).encode()
    req = urllib.request.Request(
        callback_url,
        data=payload,
        headers={"Content-Type": "application/json", "X-Secret": callback_token},
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

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
    post_callback(chat_id, text)
    print(json.dumps({"ok": True, "message_id": data.get("result", {}).get("message_id")}))

if __name__ == "__main__":
    main()
