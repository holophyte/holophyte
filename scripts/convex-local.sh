#!/usr/bin/env bash
set -euo pipefail

# Start local Convex backend using ports from .dev-ports

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"
ENV_LOCAL="$REPO_ROOT/.env.local"

if [ ! -f "$DEV_PORTS" ]; then
  echo "Error: .dev-ports file not found at $DEV_PORTS"
  echo ""
  echo "Create it with:"
  echo "  DEV_PORT=8080"
  echo "  CONVEX_CLOUD_PORT=3210"
  echo "  CONVEX_SITE_PORT=3211"
  echo "  CONVEX_TEAM=ko-vial"
  echo "  CONVEX_PROJECT=holophyte"
  exit 1
fi

# shellcheck source=/dev/null
source "$DEV_PORTS"

if ! [[ "${CONVEX_CLOUD_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_SITE_PORT:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: .dev-ports is missing required variables (CONVEX_CLOUD_PORT, CONVEX_SITE_PORT)"
  exit 1
fi

# Kill any lingering processes on Convex ports (prevents Convex from auto-incrementing)
for PORT_NUM in "$CONVEX_CLOUD_PORT" "$CONVEX_SITE_PORT"; do
  if lsof -ti :"$PORT_NUM" >/dev/null 2>&1; then
    echo "Port $PORT_NUM in use — killing lingering process..."
    lsof -ti :"$PORT_NUM" | xargs kill -9 2>/dev/null || true
  fi
done

# Check if .env.local already has a local deployment configured
CURRENT_DEPLOYMENT=""
ENV_CONVEX_URL=""
if [ -f "$ENV_LOCAL" ]; then
  CURRENT_DEPLOYMENT=$(grep '^CONVEX_DEPLOYMENT=' "$ENV_LOCAL" | cut -d= -f2 | cut -d' ' -f1 | sed 's/^"\(.*\)"$/\1/' || true)
  ENV_CONVEX_URL=$(grep '^CONVEX_URL=' "$ENV_LOCAL" | cut -d= -f2 | tr -d '"' || true)
fi

EXPECTED_URL="http://127.0.0.1:$CONVEX_CLOUD_PORT"
NEEDS_RECONFIGURE=false

if [[ "$CURRENT_DEPLOYMENT" != local:* ]]; then
  NEEDS_RECONFIGURE=true
elif [ "$ENV_CONVEX_URL" != "$EXPECTED_URL" ]; then
  # .env.local points to a different port than .dev-ports — stale from another
  # worktree or copied from main repo. Must reconfigure.
  echo "Detected stale deployment (CONVEX_URL=$ENV_CONVEX_URL, expected=$EXPECTED_URL)"
  NEEDS_RECONFIGURE=true
fi

if [ "$NEEDS_RECONFIGURE" = true ]; then
  if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
    echo "Error: .dev-ports is missing CONVEX_TEAM and CONVEX_PROJECT (needed to switch from cloud to local)"
    exit 1
  fi

  # Save non-Convex vars — convex dev --configure existing overwrites .env.local
  NON_CONVEX_VARS=""
  if [ -f "$ENV_LOCAL" ]; then
    NON_CONVEX_VARS=$(grep -vE '^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL|# Deployment used by|$)' \
      "$ENV_LOCAL" || true)
  fi

  echo "Configuring local Convex deployment (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
  bunx convex dev --configure existing \
    --team "$CONVEX_TEAM" \
    --project "$CONVEX_PROJECT" \
    --dev-deployment local \
    --local-cloud-port "$CONVEX_CLOUD_PORT" \
    --local-site-port "$CONVEX_SITE_PORT"

  # Restore non-Convex vars (API keys, secrets) that Convex overwrote
  if [ -n "$NON_CONVEX_VARS" ]; then
    printf '\n%s\n' "$NON_CONVEX_VARS" >> "$ENV_LOCAL"
  fi
else
  echo "Starting local Convex (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
  bunx convex dev --local \
    --local-cloud-port "$CONVEX_CLOUD_PORT" \
    --local-site-port "$CONVEX_SITE_PORT"
fi
