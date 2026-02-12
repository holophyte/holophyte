#!/usr/bin/env bash
set -euo pipefail

# Start local Convex backend using ports from .dev-ports

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"
LOCKFILE="$REPO_ROOT/.convex-local.pid"

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

if ! [[ "${CONVEX_CLOUD_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_SITE_PORT:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: .dev-ports is missing required variables (CONVEX_CLOUD_PORT, CONVEX_SITE_PORT)"
  exit 1
fi

# Prevent duplicate instances in the same workspace
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Error: convex:local is already running (PID $OLD_PID)"
    echo "Stop it first, or remove $LOCKFILE if the process is stale."
    exit 1
  fi
  rm -f "$LOCKFILE"
fi

echo $$ > "$LOCKFILE"
trap 'rm -f "$LOCKFILE"' EXIT

echo "Starting local Convex (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
exec npx convex dev --local \
  --local-cloud-port "$CONVEX_CLOUD_PORT" \
  --local-site-port "$CONVEX_SITE_PORT"
