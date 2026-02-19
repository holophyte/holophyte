#!/usr/bin/env bash
set -euo pipefail

# Start full cloud dev environment: app server + cloud Convex backend

APP_PORT="${PORT:-8080}"

# Kill any lingering process on the app port (prevents Bun from auto-incrementing)
if lsof -ti :"$APP_PORT" >/dev/null 2>&1; then
  echo "Port $APP_PORT in use — killing lingering process..."
  lsof -ti :"$APP_PORT" | xargs kill -9 2>/dev/null || true
fi

echo "Starting dev environment (app=$APP_PORT, convex=cloud)..."
bunx concurrently -k --kill-signal SIGINT -n server,convex -c blue,magenta \
  "bun run --watch src/server.ts" \
  "bun run convex:dev"
