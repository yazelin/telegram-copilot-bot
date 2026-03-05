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
