#!/usr/bin/env python3
"""Generate an image using Google Gemini API directly (no MCP needed)."""
import sys
import os
import json
import base64
import urllib.request
import urllib.error

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: generate_image.py <prompt>"}))
        sys.exit(1)

    prompt = sys.argv[1]
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "GEMINI_API_KEY not set"}))
        sys.exit(1)

    output_dir = "/tmp/generated-images"
    os.makedirs(output_dir, exist_ok=True)

    models = [
        "gemini-3-pro-image-preview",
        "gemini-3.1-flash-image-preview",
        "gemini-2.5-flash-image",
    ]

    last_error = None
    for model in models:
        try:
            result = generate_with_model(api_key, model, prompt, output_dir)
            if result:
                print(json.dumps({"ok": True, "file_path": result, "model": model}))
                return
        except Exception as e:
            last_error = str(e)
            print(f"Model {model} failed: {last_error}", file=sys.stderr)
            continue

    print(json.dumps({"ok": False, "error": f"All models failed. Last error: {last_error}"}))
    sys.exit(1)


def generate_with_model(api_key, model, prompt, output_dir):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseModalities": ["TEXT", "IMAGE"]
        }
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        raise Exception(f"HTTP {e.code}: {error_body[:500]}")

    candidates = body.get("candidates", [])
    if not candidates:
        raise Exception(f"No candidates in response: {json.dumps(body)[:500]}")

    parts = candidates[0].get("content", {}).get("parts", [])
    for part in parts:
        inline_data = part.get("inlineData")
        if inline_data and inline_data.get("mimeType", "").startswith("image/"):
            ext = inline_data["mimeType"].split("/")[-1].replace("jpeg", "jpg")
            file_path = os.path.join(output_dir, f"image.{ext}")
            image_bytes = base64.b64decode(inline_data["data"])
            with open(file_path, "wb") as f:
                f.write(image_bytes)
            return file_path

    raise Exception(f"No image in response parts: {json.dumps(parts)[:500]}")


if __name__ == "__main__":
    main()
