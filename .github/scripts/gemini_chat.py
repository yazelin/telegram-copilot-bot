#!/usr/bin/env python3
"""Generic Gemini text chat script supporting multiple modes."""
import sys
import os
import json
import urllib.request
import urllib.error

SYSTEM_PROMPTS = {
    "chat": (
        "你是友善的 AI 助手，用繁體中文回覆。"
        "如果你判斷自己無法處理使用者的要求（例如：需要上網搜尋最新資訊、需要寫程式碼並建立專案、"
        "需要建立 GitHub repo、需要操作檔案系統），請只回覆 <<<ROUTE_TO_COPILOT>>> 這個標記，"
        "不要加任何其他內容。"
    ),
    "translate": (
        "你是翻譯助手。規則：\n"
        "- 如果輸入是中文，翻譯成英文\n"
        "- 如果輸入是英文，翻譯成繁體中文\n"
        "- 如果輸入是其他語言，翻譯成繁體中文\n"
        "- 只輸出翻譯結果，不要加任何解釋\n"
        "- 保持原文的語氣和格式"
    ),
    "optimize_draw_prompt": (
        "你是圖片生成 prompt 優化專家。"
        "將使用者的描述轉換為詳細的英文圖片生成 prompt。"
        "要求：\n"
        "- 輸出純英文\n"
        "- 加入風格、光影、構圖等細節描述\n"
        "- 嚴格保留使用者指定的所有參數（解析度、畫質、尺寸、風格等），不得擅自更改\n"
        "- 保持使用者的核心意圖\n"
        "- 只輸出 prompt，不要加任何解釋或前綴"
    ),
}

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"ok": False, "error": "Usage: gemini_chat.py <mode> <text>"}))
        sys.exit(1)

    mode = sys.argv[1]
    text = sys.argv[2]

    if mode not in SYSTEM_PROMPTS:
        print(json.dumps({"ok": False, "error": f"Unknown mode: {mode}. Valid: {', '.join(SYSTEM_PROMPTS)}"}))
        sys.exit(1)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(json.dumps({"ok": False, "error": "GEMINI_API_KEY not set"}))
        sys.exit(1)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"

    payload = {
        "contents": [
            {"role": "user", "parts": [{"text": text}]}
        ],
        "systemInstruction": {
            "parts": [{"text": SYSTEM_PROMPTS[mode]}]
        },
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="replace")
        print(json.dumps({"ok": False, "error": f"HTTP {e.code}: {error_body[:500]}"}))
        sys.exit(1)

    candidates = body.get("candidates", [])
    if not candidates:
        print(json.dumps({"ok": False, "error": f"No candidates: {json.dumps(body)[:500]}"}))
        sys.exit(1)

    parts = candidates[0].get("content", {}).get("parts", [])
    reply = ""
    for part in parts:
        if "text" in part:
            reply += part["text"]

    if not reply:
        print(json.dumps({"ok": False, "error": "Empty response from model"}))
        sys.exit(1)

    print(json.dumps({"ok": True, "text": reply.strip(), "model": MODEL}))


if __name__ == "__main__":
    main()
