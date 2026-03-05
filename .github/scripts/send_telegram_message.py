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
