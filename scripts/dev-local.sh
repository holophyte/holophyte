#!/usr/bin/env bash
set -euo pipefail

# Start full local dev environment: app server + local Convex backend

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"
LOCKFILE="$REPO_ROOT/.dev-local.pid"

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

# Prevent duplicate instances in the same workspace
if [ -f "$LOCKFILE" ]; then
  OLD_PID=$(cat "$LOCKFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Error: dev:local is already running (PID $OLD_PID)"
    echo "Stop it first, or remove $LOCKFILE if the process is stale."
    exit 1
  fi
  # Stale lockfile — remove it
  rm -f "$LOCKFILE"
fi

echo $$ > "$LOCKFILE"
cleanup() {
  # Kill entire process group so grandchildren (bun server, convex-local) don't orphan
  kill -- -$$ 2>/dev/null || true
  rm -f "$LOCKFILE"
}
trap cleanup EXIT

export PORT="$DEV_PORT"
# Auto-enable anonymous auth for local dev (manual testing via ?auth query param)
export ALLOW_ANONYMOUS_AUTH="${ALLOW_ANONYMOUS_AUTH:-1}"

# Pre-export the local Convex URLs so the Bun server gets the correct values
# immediately, even if convex-local.sh hasn't reconfigured .env.local yet.
# Without this, the server reads the stale cloud URL from .env.local because
# concurrently starts both processes at the same time, and bun --watch doesn't
# re-read env files after startup. Shell env vars take priority over .env files
# in Bun's env loading, so this guarantees the right URL from the first request.
export CONVEX_URL="http://127.0.0.1:$CONVEX_CLOUD_PORT"
export CONVEX_SITE_URL="http://127.0.0.1:$CONVEX_SITE_PORT"

# Kill any lingering processes on dev ports (prevents Bun/Convex from auto-incrementing)
for PORT_NUM in "$DEV_PORT" "$CONVEX_CLOUD_PORT" "$CONVEX_SITE_PORT"; do
  if lsof -ti :"$PORT_NUM" >/dev/null 2>&1; then
    echo "Port $PORT_NUM in use — killing lingering process..."
    lsof -ti :"$PORT_NUM" | xargs kill -9 2>/dev/null || true
  fi
done

echo "Starting dev environment (app=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT)..."
bunx concurrently -k --kill-signal SIGINT -n server,convex -c blue,magenta \
  "bun run --watch src/server.ts" \
  "$SCRIPT_DIR/convex-local.sh"
