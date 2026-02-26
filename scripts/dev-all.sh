#!/usr/bin/env bash
set -euo pipefail

# Start full cloud dev environment: app server + cloud Convex backend

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_LOCAL="$REPO_ROOT/.env.local"
DEV_PORTS="$REPO_ROOT/.dev-ports"

APP_PORT="${PORT:-8080}"

# Kill any lingering process on the app port (prevents Bun from auto-incrementing)
if lsof -ti :"$APP_PORT" >/dev/null 2>&1; then
  echo "Port $APP_PORT in use — killing lingering process..."
  lsof -ti :"$APP_PORT" | xargs kill -9 2>/dev/null || true
fi

# If .env.local has a local deployment, reconfigure for cloud
if [ -f "$ENV_LOCAL" ]; then
  CURRENT_DEPLOYMENT=$(grep '^CONVEX_DEPLOYMENT=' "$ENV_LOCAL" | cut -d= -f2 | cut -d' ' -f1 | sed 's/^"\(.*\)"$/\1/' || true)
  if [[ "$CURRENT_DEPLOYMENT" == local:* ]]; then
    # Read team/project from .dev-ports
    if [ -f "$DEV_PORTS" ]; then
      # shellcheck source=/dev/null
      source "$DEV_PORTS"
    fi

    if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
      echo "Error: .dev-ports is missing CONVEX_TEAM and CONVEX_PROJECT (needed to switch from local to cloud)"
      exit 1
    fi

    # Save non-Convex vars — convex dev --configure overwrites .env.local
    NON_CONVEX_VARS=""
    NON_CONVEX_VARS=$(grep -vE '^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL|# Deployment used by|$)' \
      "$ENV_LOCAL" || true)

    echo "Switching from local to cloud Convex deployment..."
    bunx convex dev --configure existing \
      --team "$CONVEX_TEAM" \
      --project "$CONVEX_PROJECT"

    # Restore non-Convex vars (API keys, secrets) that Convex overwrote
    if [ -n "$NON_CONVEX_VARS" ]; then
      printf '\n%s\n' "$NON_CONVEX_VARS" >> "$ENV_LOCAL"
    fi
  fi
fi

echo "Starting dev environment (app=$APP_PORT, convex=cloud)..."
bunx concurrently -k --kill-signal SIGINT -n server,convex -c blue,magenta \
  "bun run --watch src/server.ts" \
  "bun run convex:dev"
