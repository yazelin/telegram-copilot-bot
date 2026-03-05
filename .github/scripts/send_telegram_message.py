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
    _post_callback(chat_id, text)

def _post_callback(chat_id, text):
    callback_url = os.environ.get("CALLBACK_URL", "")
    secret = os.environ.get("TELEGRAM_SECRET", "")
    if not callback_url:
        return
    try:
        from datetime import datetime, timezone
        payload = json.dumps({"type": "bot_reply", "chat_id": chat_id,
            "text": text[:500], "timestamp": datetime.now(timezone.utc).isoformat()}).encode()
        req = urllib.request.Request(callback_url, data=payload,
            headers={"Content-Type": "application/json", "X-Secret": secret})
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass

if __name__ == "__main__":
    main()
