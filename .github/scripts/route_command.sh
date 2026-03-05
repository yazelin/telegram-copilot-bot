#!/usr/bin/env bash
# Route Telegram commands: handle simple ones in shell/Gemini, forward complex ones to Copilot.
# Input env: CHAT_ID, TEXT, TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, GH_TOKEN
# Output: sets GitHub Actions output needs_copilot=true/false
set -euo pipefail
set -f  # Disable globbing to protect against user text containing *, ? etc.

SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"

# --- Helper functions (avoid storing commands in string variables) ---

send_msg()      { python3 "$SCRIPTS_DIR/send_telegram_message.py" "$@"; }
send_photo()    { python3 "$SCRIPTS_DIR/send_telegram_photo.py" "$@"; }
send_video()    { python3 "$SCRIPTS_DIR/send_telegram_video.py" "$@"; }
gemini_chat()   { python3 "$SCRIPTS_DIR/gemini_chat.py" "$@"; }
generate_image(){ python3 "$SCRIPTS_DIR/generate_image.py" "$@"; }
download_video(){ python3 "$SCRIPTS_DIR/download_video.py" "$@"; }
trigger_wf()    { python3 "$SCRIPTS_DIR/trigger_workflow.py" "$@"; }
post_comment()  { python3 "$SCRIPTS_DIR/post_comment.py" "$@"; }
manage_labels() { python3 "$SCRIPTS_DIR/manage_labels.py" "$@"; }

set_output() {
  echo "needs_copilot=$1" >> "${GITHUB_OUTPUT:-/dev/null}"
}

send_error() {
  send_msg "$CHAT_ID" "❌ $1" || true
}

# Extract a field from JSON on stdin: json_field <key> [default]
json_field() {
  python3 -c "import sys,json; print(json.load(sys.stdin).get('$1','${2:-}'))" 2>/dev/null
}

# Strip leading/trailing whitespace (safe for -n, backslashes, etc.)
TEXT="${TEXT#"${TEXT%%[![:space:]]*}"}"
TEXT="${TEXT%"${TEXT##*[![:space:]]}"}"

case "$TEXT" in
  /build\ *)
    REPO="${TEXT#/build }"
    REPO="${REPO#"${REPO%%[![:space:]]*}"}"
    RESULT=$(trigger_wf "$REPO" "implement.yml") || true
    OK=$(printf '%s' "$RESULT" | json_field ok False || echo "False")
    if [ "$OK" = "True" ]; then
      send_msg "$CHAT_ID" "🚀 已觸發 $REPO 開發流程，可到 https://github.com/$REPO/actions 查看進度"
    else
      ERROR=$(printf '%s' "$RESULT" | json_field error "Unknown error" || echo "$RESULT")
      send_error "觸發 build 失敗: $ERROR"
    fi
    set_output false
    ;;

  /build)
    send_error "用法: /build owner/repo"
    set_output false
    ;;

  /msg\ *)
    # Parse: /msg owner/repo#number message
    ARGS="${TEXT#/msg }"
    # Extract repo#number (restrict to safe chars for repo name)
    TARGET=$(printf '%s' "$ARGS" | grep -oE '^[a-zA-Z0-9._/-]+#[0-9]+' || true)
    if [ -z "$TARGET" ]; then
      send_error "格式錯誤，請用: /msg owner/repo#number message"
      set_output false
      exit 0
    fi
    REPO="${TARGET%%#*}"
    NUMBER="${TARGET##*#}"
    MESSAGE="${ARGS#*"$TARGET"}"
    MESSAGE="${MESSAGE#"${MESSAGE%%[![:space:]]*}"}"

    post_comment "$REPO" "$NUMBER" "📝 User instruction:

$MESSAGE" || true

    # Remove stuck/review labels if present, then trigger workflow
    manage_labels "$REPO" "$NUMBER" remove "agent-stuck" 2>/dev/null || true
    manage_labels "$REPO" "$NUMBER" remove "needs-human-review" 2>/dev/null || true
    trigger_wf "$REPO" "implement.yml" 2>/dev/null || true

    send_msg "$CHAT_ID" "📝 已將指示傳達給 $REPO #$NUMBER"
    set_output false
    ;;

  /msg)
    send_error "用法: /msg owner/repo#number message"
    set_output false
    ;;

  /download\ *)
    URL="${TEXT#/download }"
    URL="${URL#"${URL%%[![:space:]]*}"}"

    RESULT=$(download_video "$URL") || true
    OK=$(printf '%s' "$RESULT" | json_field ok False || echo "False")

    if [ "$OK" != "True" ]; then
      ERROR=$(printf '%s' "$RESULT" | json_field error "下載失敗" || echo "下載失敗")
      send_error "下載失敗: $ERROR"
      set_output false
      exit 0
    fi

    FILE_PATH=$(printf '%s' "$RESULT" | json_field file_path "" || echo "")
    TITLE=$(printf '%s' "$RESULT" | json_field title "Video" || echo "Video")
    FILESIZE=$(printf '%s' "$RESULT" | json_field filesize 0 || echo "0")

    # Validate filesize is numeric
    if ! [[ "$FILESIZE" =~ ^[0-9]+$ ]]; then
      FILESIZE=0
    fi

    if [ "$FILESIZE" -le 50000000 ]; then
      send_video "$CHAT_ID" "$FILE_PATH" "$TITLE" || send_error "影片傳送失敗"
    else
      send_msg "$CHAT_ID" "⚠️ 影片太大 ($(( FILESIZE / 1048576 ))MB)，超過 Telegram 50MB 限制"
    fi
    set_output false
    ;;

  /download)
    send_error "用法: /download <url>"
    set_output false
    ;;

  /draw\ *)
    DESCRIPTION="${TEXT#/draw }"
    DESCRIPTION="${DESCRIPTION#"${DESCRIPTION%%[![:space:]]*}"}"

    # Send "processing" indicator
    send_msg "$CHAT_ID" "🎨 正在生成圖片，請稍候..." || true

    # Optimize prompt with Gemini
    OPT_RESULT=$(gemini_chat optimize_draw_prompt "$DESCRIPTION") || true
    OPT_OK=$(printf '%s' "$OPT_RESULT" | json_field ok False || echo "False")

    if [ "$OPT_OK" = "True" ]; then
      PROMPT=$(printf '%s' "$OPT_RESULT" | json_field text "" || echo "")
    fi
    # Fallback: use original description
    if [ -z "${PROMPT:-}" ]; then
      PROMPT="$DESCRIPTION"
    fi

    # Generate image
    IMG_RESULT=$(generate_image "$PROMPT") || true
    IMG_OK=$(printf '%s' "$IMG_RESULT" | json_field ok False || echo "False")

    if [ "$IMG_OK" = "True" ]; then
      IMG_PATH=$(printf '%s' "$IMG_RESULT" | json_field file_path "" || echo "")
      send_photo "$CHAT_ID" "$IMG_PATH" "$DESCRIPTION" || send_error "圖片傳送失敗"
    else
      ERROR=$(printf '%s' "$IMG_RESULT" | json_field error "圖片生成失敗" || echo "圖片生成失敗")
      send_error "圖片生成失敗: $ERROR"
    fi
    set_output false
    ;;

  /draw)
    send_error "用法: /draw <描述>"
    set_output false
    ;;

  /translate\ *)
    INPUT="${TEXT#/translate }"
    INPUT="${INPUT#"${INPUT%%[![:space:]]*}"}"

    RESULT=$(gemini_chat translate "$INPUT") || true
    OK=$(printf '%s' "$RESULT" | json_field ok False || echo "False")

    if [ "$OK" = "True" ]; then
      TRANSLATED=$(printf '%s' "$RESULT" | json_field text "" || echo "")
      send_msg "$CHAT_ID" "🌐 翻譯結果:

$TRANSLATED"
    else
      ERROR=$(printf '%s' "$RESULT" | json_field error "翻譯失敗" || echo "翻譯失敗")
      send_error "翻譯失敗: $ERROR"
    fi
    set_output false
    ;;

  /translate)
    send_error "用法: /translate <文字>"
    set_output false
    ;;

  /app\ *|/issue\ *|/research\ *)
    # These need Copilot CLI
    set_output true
    ;;

  /app|/issue|/research)
    send_error "請在命令後加上描述，例如: /app 計算機"
    set_output false
    ;;

  *)
    # No command prefix: try Gemini chat, fallback to Copilot
    RESULT=$(gemini_chat chat "$TEXT") || true
    OK=$(printf '%s' "$RESULT" | json_field ok False || echo "False")

    if [ "$OK" = "True" ]; then
      REPLY=$(printf '%s' "$RESULT" | json_field text "" || echo "")
      if printf '%s' "$REPLY" | grep -q '<<<ROUTE_TO_COPILOT>>>'; then
        set_output true
      else
        send_msg "$CHAT_ID" "$REPLY"
        set_output false
      fi
    else
      # Gemini failed, fallback to Copilot
      set_output true
    fi
    ;;
esac
