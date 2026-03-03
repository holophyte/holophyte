#!/usr/bin/env bash
set -euo pipefail

# One-time setup for local Convex development (idempotent — safe to re-run)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"
ENV_FILE="$REPO_ROOT/.env"

# ── Colors ───────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1"; }

# ── Step 1: Check/create .dev-ports ──────────────────────────────────

if [ -f "$DEV_PORTS" ]; then
  info ".dev-ports already exists"
  # shellcheck source=/dev/null
  source "$DEV_PORTS"
else
  echo "Creating .dev-ports with default values..."

  # Prompt for CONVEX_TEAM and CONVEX_PROJECT (no sensible defaults)
  read -rp "CONVEX_TEAM (e.g. ko-vial): " CONVEX_TEAM
  read -rp "CONVEX_PROJECT (e.g. holophyte): " CONVEX_PROJECT

  if [ -z "$CONVEX_TEAM" ] || [ -z "$CONVEX_PROJECT" ]; then
    error "CONVEX_TEAM and CONVEX_PROJECT are required"
    exit 1
  fi

  DEV_PORT=8080
  CONVEX_CLOUD_PORT=3210
  CONVEX_SITE_PORT=3211

  cat > "$DEV_PORTS" <<EOF
DEV_PORT=$DEV_PORT
CONVEX_CLOUD_PORT=$CONVEX_CLOUD_PORT
CONVEX_SITE_PORT=$CONVEX_SITE_PORT
CONVEX_TEAM=$CONVEX_TEAM
CONVEX_PROJECT=$CONVEX_PROJECT
EOF
  info "Created .dev-ports (dev=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT)"
fi

# ── Step 2: Validate required values ────────────────────────────────

if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
  error ".dev-ports is missing CONVEX_TEAM and/or CONVEX_PROJECT"
  echo "  Add them to $DEV_PORTS and re-run."
  exit 1
fi

if ! [[ "${DEV_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_CLOUD_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_SITE_PORT:-}" =~ ^[0-9]+$ ]]; then
  error ".dev-ports is missing port variables (DEV_PORT, CONVEX_CLOUD_PORT, CONVEX_SITE_PORT)"
  exit 1
fi

info "Config: team=$CONVEX_TEAM project=$CONVEX_PROJECT dev=$DEV_PORT convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"

# ── Step 3: Provision local Convex deployment ────────────────────────

# Check if .env.local already has a local deployment at the right ports
ALREADY_CONFIGURED=false
ENV_LOCAL="$REPO_ROOT/.env.local"
if [ -f "$ENV_LOCAL" ]; then
  CURRENT_DEPLOYMENT=$(grep '^CONVEX_DEPLOYMENT=' "$ENV_LOCAL" | cut -d= -f2 | cut -d' ' -f1 | sed 's/^"\(.*\)"$/\1/' || true)
  ENV_CONVEX_URL=$(grep '^CONVEX_URL=' "$ENV_LOCAL" | cut -d= -f2 | tr -d '"' || true)
  EXPECTED_URL="http://127.0.0.1:$CONVEX_CLOUD_PORT"

  if [[ "$CURRENT_DEPLOYMENT" == local:* ]] && [ "$ENV_CONVEX_URL" = "$EXPECTED_URL" ]; then
    ALREADY_CONFIGURED=true
  fi
fi

if [ "$ALREADY_CONFIGURED" = true ]; then
  info "Local Convex deployment already configured in .env.local"
else
  echo "Provisioning local Convex deployment..."

  # Save non-Convex vars — convex dev --configure existing overwrites .env.local
  NON_CONVEX_VARS=""
  if [ -f "$ENV_LOCAL" ]; then
    NON_CONVEX_VARS=$(grep -vE '^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL|# Deployment used by|$)' \
      "$ENV_LOCAL" || true)
  fi

  cd "$REPO_ROOT" && bunx convex dev --configure existing \
    --team "$CONVEX_TEAM" \
    --project "$CONVEX_PROJECT" \
    --dev-deployment local \
    --local-cloud-port "$CONVEX_CLOUD_PORT" \
    --local-site-port "$CONVEX_SITE_PORT" \
    --once

  # Restore non-Convex vars (API keys, secrets) that Convex overwrote
  if [ -n "$NON_CONVEX_VARS" ]; then
    printf '\n%s\n' "$NON_CONVEX_VARS" >> "$ENV_LOCAL"
  fi

  info "Local Convex deployment provisioned"
fi

# ── Step 4: Start temp backend, set env vars, configure auth ─────────

# Check if env vars are already set by looking for markers in .env
INTERNAL_SECRET_EXISTS=false
if [ -f "$ENV_FILE" ] && grep -q '^INTERNAL_API_SECRET=' "$ENV_FILE"; then
  INTERNAL_SECRET_EXISTS=true
fi

# We need a running backend to set env vars and run auth setup.
# Check if one is already running on the expected port.
CONVEX_BG_PID=""
STARTED_TEMP_BACKEND=false

if curl -sf "http://127.0.0.1:$CONVEX_CLOUD_PORT" >/dev/null 2>&1; then
  info "Convex backend already running on port $CONVEX_CLOUD_PORT"
else
  echo "Starting temporary Convex backend for env var setup..."
  cd "$REPO_ROOT" && bunx convex dev --local \
    --local-cloud-port "$CONVEX_CLOUD_PORT" \
    --local-site-port "$CONVEX_SITE_PORT" &
  CONVEX_BG_PID=$!
  STARTED_TEMP_BACKEND=true

  # Wait for the backend to be ready
  for i in $(seq 1 30); do
    if ! kill -0 "$CONVEX_BG_PID" 2>/dev/null; then
      error "Convex backend crashed during startup"
      exit 1
    fi
    if curl -sf "http://127.0.0.1:$CONVEX_CLOUD_PORT" >/dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 30 ]; then
      error "Timed out waiting for Convex backend"
      exit 1
    fi
    sleep 1
  done

  info "Temporary Convex backend is running"
fi

# Ensure we clean up the background process on exit (if we started one)
cleanup() {
  if [ -n "$CONVEX_BG_PID" ] && kill -0 "$CONVEX_BG_PID" 2>/dev/null; then
    kill "$CONVEX_BG_PID" 2>/dev/null || true
    wait "$CONVEX_BG_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# Set SITE_URL — required by Convex Auth (@convex-dev/auth) for OAuth callback routing.
cd "$REPO_ROOT" && bunx convex env set SITE_URL "http://localhost:$DEV_PORT"
info "Set SITE_URL=http://localhost:$DEV_PORT"

# Set ALLOW_ANONYMOUS_AUTH for manual testing via ?auth
cd "$REPO_ROOT" && bunx convex env set ALLOW_ANONYMOUS_AUTH 1
info "Set ALLOW_ANONYMOUS_AUTH=1"

# Generate and set INTERNAL_API_SECRET
if [ "$INTERNAL_SECRET_EXISTS" = true ]; then
  INTERNAL_API_SECRET=$(grep '^INTERNAL_API_SECRET=' "$ENV_FILE" | head -1 | cut -d= -f2)
  info "INTERNAL_API_SECRET already exists in .env"
else
  INTERNAL_API_SECRET=$(openssl rand -hex 32)
  echo "INTERNAL_API_SECRET=$INTERNAL_API_SECRET" >> "$ENV_FILE"
  info "Generated INTERNAL_API_SECRET and added to .env"
fi
cd "$REPO_ROOT" && bunx convex env set INTERNAL_API_SECRET "$INTERNAL_API_SECRET"
info "Set INTERNAL_API_SECRET on Convex deployment"

# Generate JWT keys for Convex Auth (skip if already configured)
AUTH_KEYS_EXIST=false
if cd "$REPO_ROOT" && bunx convex env get JWT_PRIVATE_KEY >/dev/null 2>&1; then
  AUTH_KEYS_EXIST=true
fi

if [ "$AUTH_KEYS_EXIST" = true ]; then
  info "Convex Auth keys already configured"
else
  echo "Setting up Convex Auth keys..."
  cd "$REPO_ROOT" && bunx @convex-dev/auth
  info "Convex Auth keys configured"
fi

# Forward OAuth credentials from .dev-ports (if present)
if [ -n "${AUTH_GITHUB_ID:-}" ] && [ -n "${AUTH_GITHUB_SECRET:-}" ]; then
  cd "$REPO_ROOT" && bunx convex env set AUTH_GITHUB_ID "$AUTH_GITHUB_ID"
  cd "$REPO_ROOT" && bunx convex env set AUTH_GITHUB_SECRET "$AUTH_GITHUB_SECRET"
  info "Set GitHub OAuth credentials"
fi
if [ -n "${AUTH_GOOGLE_ID:-}" ] && [ -n "${AUTH_GOOGLE_SECRET:-}" ]; then
  cd "$REPO_ROOT" && bunx convex env set AUTH_GOOGLE_ID "$AUTH_GOOGLE_ID"
  cd "$REPO_ROOT" && bunx convex env set AUTH_GOOGLE_SECRET "$AUTH_GOOGLE_SECRET"
  info "Set Google OAuth credentials"
fi

# Stop the temporary backend (only if we started one)
if [ "$STARTED_TEMP_BACKEND" = true ] && [ -n "$CONVEX_BG_PID" ]; then
  kill "$CONVEX_BG_PID" 2>/dev/null || true
  wait "$CONVEX_BG_PID" 2>/dev/null || true
fi

# ── Done ─────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}Local setup complete!${NC}"
echo ""
echo "  .dev-ports:  dev=$DEV_PORT  convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"
echo "  team=$CONVEX_TEAM  project=$CONVEX_PROJECT"
echo ""
echo "Next steps:"
echo "  bun run dev:local          # Start the dev server + local Convex"
echo "  http://localhost:$DEV_PORT?auth   # Open in browser (anonymous auth)"
