#!/usr/bin/env bash
set -euo pipefail

# Start full local dev environment: app server + local Convex backend

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"

if [ ! -f "$DEV_PORTS" ]; then
  echo "Error: .dev-ports file not found at $DEV_PORTS"
  echo ""
  echo "Create it with:"
  echo "  DEV_PORT=8080"
  echo "  CONVEX_CLOUD_PORT=3210"
  echo "  CONVEX_SITE_PORT=3211"
  exit 1
fi

# shellcheck source=/dev/null
source "$DEV_PORTS"

if ! [[ "${DEV_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_CLOUD_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_SITE_PORT:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: .dev-ports is missing required variables (DEV_PORT, CONVEX_CLOUD_PORT, CONVEX_SITE_PORT)"
  exit 1
fi

echo "Starting dev environment (app=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT)..."
exec npx concurrently -n server,convex -c blue,magenta \
  "PORT=$DEV_PORT bun run --watch src/server.ts" \
  "$SCRIPT_DIR/convex-local.sh"
