#!/usr/bin/env bash
# setup.sh — One-click setup wizard for telegram-copilot-bot
# Usage: bash setup.sh
set -euo pipefail

# ─── Colors & helpers ───────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { printf "${BLUE}ℹ${NC}  %s\n" "$*"; }
success() { printf "${GREEN}✅${NC} %s\n" "$*"; }
warn()    { printf "${YELLOW}⚠️${NC}  %s\n" "$*"; }
error()   { printf "${RED}❌${NC} %s\n" "$*" >&2; }
header()  { printf "\n${BOLD}${CYAN}── %s ──${NC}\n\n" "$*"; }

prompt_value() {
  local label="$1" default="${2:-}" value
  if [ -n "$default" ]; then
    printf "${BOLD}%s${NC} [%s]: " "$label" "$default"
  else
    printf "${BOLD}%s${NC}: " "$label"
  fi
  read -r value
  echo "${value:-$default}"
}

prompt_secret() {
  local label="$1" value
  printf "${BOLD}%s${NC}: " "$label"
  read -rs value
  echo
  echo "$value"
}

confirm() {
  local msg="$1"
  printf "${BOLD}%s${NC} [Y/n]: " "$msg"
  read -r ans
  [[ "${ans,,}" != "n" ]]
}

# ─── Step 1: Preflight checks ──────────────────────────────────────────────

header "Step 1: Preflight Checks"

MISSING=()
command -v gh    &>/dev/null || MISSING+=("gh (GitHub CLI)")
command -v node  &>/dev/null || MISSING+=("node")
command -v npm   &>/dev/null || MISSING+=("npm")
command -v python3 &>/dev/null || MISSING+=("python3")

if [ ${#MISSING[@]} -gt 0 ]; then
  error "Missing required tools:"
  for tool in "${MISSING[@]}"; do
    echo "  - $tool"
  done
  echo
  echo "Install them and re-run this script."
  exit 1
fi

# Check gh auth
if ! gh auth status &>/dev/null; then
  error "GitHub CLI not authenticated. Run: gh auth login"
  exit 1
fi

GH_USER=$(gh api user -q '.login')
success "All prerequisites met (logged in as ${BOLD}$GH_USER${NC})"

# ─── Step 2: Detect install mode ───────────────────────────────────────────

header "Step 2: Repository Setup"

REPO_FULL=""
IS_FORK=false

if git rev-parse --is-inside-work-tree &>/dev/null; then
  REMOTE_URL=$(git remote get-url origin 2>/dev/null || echo "")
  if [ -n "$REMOTE_URL" ]; then
    # Extract owner/repo from remote URL
    REPO_FULL=$(echo "$REMOTE_URL" | sed -E 's#.*github\.com[:/]([^/]+/[^/.]+)(\.git)?$#\1#')
    PARENT=$(gh repo view "$REPO_FULL" --json parent -q '.parent.owner.login + "/" + .parent.name' 2>/dev/null || echo "")
    if [ -n "$PARENT" ] && [ "$PARENT" != "/" ]; then
      IS_FORK=true
      info "Detected fork of ${BOLD}$PARENT${NC}"
      success "Using fork mode with repo: ${BOLD}$REPO_FULL${NC}"
    else
      info "Detected repo: ${BOLD}$REPO_FULL${NC}"
    fi
  fi
fi

if [ -z "$REPO_FULL" ]; then
  info "No git remote detected. Let's create a new repository."
  REPO_NAME=$(prompt_value "Repository name" "telegram-copilot-bot")
  echo
  echo "  1) Public"
  echo "  2) Private"
  printf "Visibility [2]: "
  read -r VIS_CHOICE
  VIS_CHOICE="${VIS_CHOICE:-2}"
  if [ "$VIS_CHOICE" = "1" ]; then
    VISIBILITY="public"
  else
    VISIBILITY="private"
  fi

  REPO_FULL="$GH_USER/$REPO_NAME"
  info "Creating ${VISIBILITY} repo: ${BOLD}$REPO_FULL${NC}"
  gh repo create "$REPO_FULL" --"$VISIBILITY" --source=. --push
  success "Repository created and code pushed"
fi

OWNER="${REPO_FULL%%/*}"
REPO="${REPO_FULL##*/}"

# ─── Step 3: Tier selection ─────────────────────────────────────────────────

header "Step 3: Feature Tier Selection"

cat << 'TIERS'
┌──────────┬──────────────────────────────────┬─────────────────────────┐
│ Tier     │ Features                         │ Required Secrets        │
├──────────┼──────────────────────────────────┼─────────────────────────┤
│ 1. Core  │ Copilot chat, /build, /msg       │ Telegram Token + 2 PAT │
│ 2. Std   │ Core + /draw, /translate, AI chat│ + Gemini + Tavily API   │
│ 3. Full  │ Std + /app, /issue (App Factory) │ + 2 PAT + GitHub Org   │
└──────────┴──────────────────────────────────┴─────────────────────────┘
TIERS

printf "\nSelect tier [1/2/3]: "
read -r TIER
TIER="${TIER:-1}"
if [[ ! "$TIER" =~ ^[123]$ ]]; then
  error "Invalid tier: $TIER"
  exit 1
fi

TIER_NAMES=( "" "Core" "Standard" "Full" )
success "Selected: ${BOLD}${TIER_NAMES[$TIER]}${NC}"

# ─── Step 4: Collect credentials ────────────────────────────────────────────

header "Step 4: Credentials"

# --- Telegram Bot Token ---
info "Create a bot via https://t.me/BotFather and paste the token."
TELEGRAM_BOT_TOKEN=$(prompt_secret "Telegram Bot Token")
if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
  error "Telegram Bot Token is required."
  exit 1
fi

# --- Telegram User ID ---
info "Your Telegram numeric user ID (send /start to @userinfobot to find it)."
TELEGRAM_USER_ID=$(prompt_value "Telegram User ID" "")
if [ -z "$TELEGRAM_USER_ID" ]; then
  error "Telegram User ID is required for ALLOWED_USERS."
  exit 1
fi

# --- COPILOT_TOKEN ---
echo
info "PAT from an account with GitHub Copilot subscription."
info "Scopes needed: (none — just needs Copilot access on the account)"
info "Create at: https://github.com/settings/tokens/new"
COPILOT_TOKEN=$(prompt_secret "COPILOT_TOKEN (Copilot account PAT)")
if [ -z "$COPILOT_TOKEN" ]; then
  error "COPILOT_TOKEN is required."
  exit 1
fi

# --- RELAY_PAT ---
echo
info "PAT with 'actions:write' on this repo (to trigger workflows)."
info "Create at: https://github.com/settings/tokens/new?scopes=repo"
RELAY_PAT=$(prompt_secret "RELAY_PAT (actions:write on $REPO_FULL)")
if [ -z "$RELAY_PAT" ]; then
  error "RELAY_PAT is required."
  exit 1
fi

# --- Standard tier secrets ---
GEMINI_API_KEY=""
TAVILY_API_KEY=""
if [ "$TIER" -ge 2 ]; then
  echo
  info "Gemini API key for /draw, /translate, AI chat."
  info "Get one at: https://aistudio.google.com/apikey"
  GEMINI_API_KEY=$(prompt_secret "GEMINI_API_KEY")
  if [ -z "$GEMINI_API_KEY" ]; then
    error "GEMINI_API_KEY is required for Standard tier."
    exit 1
  fi

  echo
  info "Tavily API key for /research web search (optional, press Enter to skip)."
  info "Get one at: https://tavily.com"
  TAVILY_API_KEY=$(prompt_secret "TAVILY_API_KEY (optional)")
fi

# --- Full tier secrets ---
FACTORY_PAT=""
FORK_TOKEN=""
APPS_ORG=""
if [ "$TIER" -ge 3 ]; then
  echo
  info "FACTORY_PAT: PAT with full org permissions for App Factory."
  info "Scopes: repo, workflow, admin:org, delete_repo"
  info "Create at: https://github.com/settings/tokens/new?scopes=repo,workflow,admin:org,delete_repo"
  FACTORY_PAT=$(prompt_secret "FACTORY_PAT")
  if [ -z "$FACTORY_PAT" ]; then
    error "FACTORY_PAT is required for Full tier."
    exit 1
  fi

  echo
  info "FORK_TOKEN: Classic PAT with 'public_repo' scope (for forking repos)."
  info "Create at: https://github.com/settings/tokens/new?scopes=public_repo"
  FORK_TOKEN=$(prompt_secret "FORK_TOKEN (optional, press Enter to skip)")

  echo
  APPS_ORG=$(prompt_value "Apps organization name" "${GH_USER}-apps")
fi

# ─── Step 5: Auto-generate TELEGRAM_SECRET ──────────────────────────────────

TELEGRAM_SECRET=$(openssl rand -hex 20)
success "Generated TELEGRAM_SECRET"

# ─── Step 6: Patch files ────────────────────────────────────────────────────

header "Step 6: Patching Configuration Files"

# Defaults from the original repo (replaced for forks/new installs)
DEFAULT_OWNER="yazelin"
DEFAULT_REPO_FULL="yazelin/telegram-copilot-bot"
DEFAULT_APPS_ORG="aw-apps"
DEFAULT_ALLOWED_USERS="850654509"

# Patch wrangler.toml — set ALLOWED_USERS
sed -i "s/^ALLOWED_USERS = .*/ALLOWED_USERS = \"$TELEGRAM_USER_ID\"/" worker/wrangler.toml
success "worker/wrangler.toml → ALLOWED_USERS = $TELEGRAM_USER_ID"

# Patch prompt.md — replace parent repo reference
if [ "$REPO_FULL" != "$DEFAULT_REPO_FULL" ]; then
  sed -i "s|$DEFAULT_REPO_FULL|$REPO_FULL|g" prompt.md
  success "prompt.md → $DEFAULT_REPO_FULL → $REPO_FULL"
fi

# Patch prompt.md + README.md — replace apps org
if [ "$TIER" -ge 3 ] && [ -n "$APPS_ORG" ] && [ "$APPS_ORG" != "$DEFAULT_APPS_ORG" ]; then
  sed -i "s/$DEFAULT_APPS_ORG/$APPS_ORG/g" prompt.md
  sed -i "s/$DEFAULT_APPS_ORG/$APPS_ORG/g" README.md
  success "prompt.md, README.md → $DEFAULT_APPS_ORG → $APPS_ORG"
fi

# Patch README.md — replace owner references
if [ "$OWNER" != "$DEFAULT_OWNER" ]; then
  sed -i "s|$DEFAULT_OWNER/telegram-copilot-bot|$REPO_FULL|g" README.md
  success "README.md → owner references updated"
fi

# ─── Step 7: Set GitHub Secrets ─────────────────────────────────────────────

header "Step 7: Setting GitHub Secrets"

set_secret() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    echo "$value" | gh secret set "$name" -R "$REPO_FULL"
    success "Secret: $name"
  fi
}

# Core secrets (PAT mapping)
set_secret "TELEGRAM_SECRET"       "$TELEGRAM_SECRET"
set_secret "TELEGRAM_BOT_TOKEN"    "$TELEGRAM_BOT_TOKEN"
set_secret "PERSONAL_ACCESS_TOKEN" "$COPILOT_TOKEN"
set_secret "CHILD_COPILOT_TOKEN"   "$COPILOT_TOKEN"
set_secret "NOTIFY_TOKEN"          "$RELAY_PAT"

# Standard tier
if [ "$TIER" -ge 2 ]; then
  set_secret "GEMINI_API_KEY" "$GEMINI_API_KEY"
  set_secret "TAVILY_API_KEY" "$TAVILY_API_KEY"
fi

# Full tier
if [ "$TIER" -ge 3 ]; then
  set_secret "FACTORY_PAT" "$FACTORY_PAT"
  set_secret "COPILOT_PAT" "$FACTORY_PAT"
  set_secret "FORK_TOKEN"  "$FORK_TOKEN"
fi

# ─── Step 8: Deploy Cloudflare Worker ───────────────────────────────────────

header "Step 8: Deploying Cloudflare Worker"

if ! command -v npx &>/dev/null; then
  error "npx not found. Please install Node.js and npm."
  exit 1
fi

cd worker
npm install
info "Deploying Worker..."
npm run deploy

# Set Worker secrets
info "Setting Worker secrets..."
echo "$TELEGRAM_BOT_TOKEN" | npx wrangler secret put TELEGRAM_BOT_TOKEN
echo "$TELEGRAM_SECRET"    | npx wrangler secret put TELEGRAM_SECRET
echo "$RELAY_PAT"          | npx wrangler secret put GH_TOKEN
echo "$REPO_FULL"          | npx wrangler secret put GH_REPO

success "Worker deployed and secrets configured"

# Get Worker URL
WORKER_URL=$(npx wrangler deployments list --json 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    # Try to extract URL from deployments
    if isinstance(data, list) and len(data) > 0:
        print(data[0].get('url', ''))
except:
    pass
" 2>/dev/null || echo "")

if [ -z "$WORKER_URL" ]; then
  # Fallback: ask user for the URL
  WORKER_NAME=$(grep '^name' wrangler.toml | sed 's/name = "\(.*\)"/\1/')
  warn "Could not auto-detect Worker URL."
  info "Check your Cloudflare dashboard or the deploy output above for the URL."
  info "It typically looks like: https://${WORKER_NAME}.<subdomain>.workers.dev"
  WORKER_URL=$(prompt_value "Worker URL" "")
  if [ -z "$WORKER_URL" ]; then
    error "Worker URL is required for webhook registration."
    echo "You can register the webhook manually later:"
    echo "  curl 'https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/<SECRET>&secret_token=<SECRET>'"
    cd ..
    exit 1
  fi
fi

cd ..

# ─── Step 9: Register Telegram Webhook ──────────────────────────────────────

header "Step 9: Registering Telegram Webhook"

WEBHOOK_URL="${WORKER_URL}/${TELEGRAM_SECRET}"
info "Registering webhook: $WEBHOOK_URL"

RESULT=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&secret_token=${TELEGRAM_SECRET}")
WH_OK=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('ok', False))" 2>/dev/null || echo "False")

if [ "$WH_OK" = "True" ]; then
  success "Webhook registered successfully"
else
  warn "Webhook registration may have failed: $RESULT"
  info "You can manually set it later:"
  echo "  curl 'https://api.telegram.org/bot<TOKEN>/setWebhook?url=<WORKER_URL>/<SECRET>&secret_token=<SECRET>'"
fi

# ─── Step 10: Commit & Push ─────────────────────────────────────────────────

header "Step 10: Commit & Push"

if git diff --quiet && git diff --cached --quiet; then
  info "No file changes to commit."
else
  git add worker/wrangler.toml prompt.md
  git commit -m "chore: configure bot for $OWNER via setup.sh

- Set ALLOWED_USERS in wrangler.toml
- Replace placeholder values in prompt.md"
  git push
  success "Changes committed and pushed"
fi

# ─── Step 11: Enable GitHub Actions (for forks) ────────────────────────────

if [ "$IS_FORK" = true ]; then
  info "Enabling GitHub Actions on fork..."
  gh api -X PUT "repos/$REPO_FULL/actions/permissions" \
    -f enabled=true -f allowed_actions=all 2>/dev/null || true
  success "Actions enabled (verify at https://github.com/$REPO_FULL/actions)"
fi

# ─── Summary ────────────────────────────────────────────────────────────────

header "Setup Complete!"

echo "Repository:  $REPO_FULL"
echo "Tier:        ${TIER_NAMES[$TIER]}"
echo

printf "  %-20s %s\n" "Feature" "Status"
printf "  %-20s %s\n" "────────────────────" "──────"
printf "  %-20s ${GREEN}✅${NC}\n" "Copilot Chat"
printf "  %-20s ${GREEN}✅${NC}\n" "/build"
printf "  %-20s ${GREEN}✅${NC}\n" "/msg"

if [ "$TIER" -ge 2 ]; then
  printf "  %-20s ${GREEN}✅${NC}\n" "/draw"
  printf "  %-20s ${GREEN}✅${NC}\n" "/translate"
  printf "  %-20s ${GREEN}✅${NC}\n" "AI Chat"
  if [ -n "$TAVILY_API_KEY" ]; then
    printf "  %-20s ${GREEN}✅${NC}\n" "/research"
  else
    printf "  %-20s ${YELLOW}⚠️${NC}  (no TAVILY_API_KEY)\n" "/research"
  fi
else
  printf "  %-20s ${RED}❌${NC}\n" "/draw"
  printf "  %-20s ${RED}❌${NC}\n" "/translate"
  printf "  %-20s ${RED}❌${NC}\n" "AI Chat"
  printf "  %-20s ${RED}❌${NC}\n" "/research"
fi

if [ "$TIER" -ge 3 ]; then
  printf "  %-20s ${GREEN}✅${NC}\n" "/app (App Factory)"
  printf "  %-20s ${GREEN}✅${NC}\n" "/issue"
else
  printf "  %-20s ${RED}❌${NC}\n" "/app (App Factory)"
  printf "  %-20s ${RED}❌${NC}\n" "/issue"
fi

echo
info "Test your bot:"
echo "  1. Open your bot in Telegram"
echo "  2. Send: hi"
if [ "$TIER" -ge 2 ]; then
  echo "  3. Send: /draw a cute cat"
  echo "  4. Send: /translate Hello world"
fi
if [ "$TIER" -ge 3 ]; then
  echo "  5. Send: /app 計算機"
fi
echo
success "Happy chatting! 🎉"
