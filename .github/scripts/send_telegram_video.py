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
    _post_callback(chat_id, caption or "[video]")

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
