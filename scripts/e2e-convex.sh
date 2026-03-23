#!/usr/bin/env bash
set -euo pipefail

# Manage an ephemeral local Convex backend for E2E tests.
# Usage: e2e-convex.sh start | stop
#
# start: provisions a fresh Convex instance on random ports, deploys
#        functions, sets ALLOW_ANONYMOUS_AUTH, writes port config
# stop:  kills the background process, restores .env.local, cleans up
#
# Note: dev Convex (bun run convex:local) must NOT be running — the Convex
# CLI refuses to provision when another local backend is active.

ACTION="${1:-start}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"

E2E_PID_FILE="$REPO_ROOT/.e2e-convex.pid"
E2E_PORTS_FILE="$REPO_ROOT/.e2e-convex-ports"
ENV_LOCAL="$REPO_ROOT/.env.local"
ENV_BACKUP="$REPO_ROOT/.env.local.dev-backup"

port_in_use() {
  lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

stop_e2e_convex() {
  if [ -f "$E2E_PID_FILE" ]; then
    local pid
    pid=$(cat "$E2E_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
    rm -f "$E2E_PID_FILE"
  fi

  # Kill any lingering processes on ephemeral ports
  if [ -f "$E2E_PORTS_FILE" ]; then
    # shellcheck source=/dev/null
    source "$E2E_PORTS_FILE"
    for p in "${E2E_CONVEX_CLOUD_PORT:-}" "${E2E_CONVEX_SITE_PORT:-}"; do
      if [ -n "$p" ] && lsof -ti :"$p" >/dev/null 2>&1; then
        lsof -ti :"$p" | xargs kill -9 2>/dev/null || true
      fi
    done
  fi

  # Restore dev .env.local
  if [ -f "$ENV_BACKUP" ]; then
    mv "$ENV_BACKUP" "$ENV_LOCAL"
  fi

  rm -f "$E2E_PORTS_FILE" "$E2E_PID_FILE"
}

start_e2e_convex() {
  if [ ! -f "$DEV_PORTS" ]; then
    echo "Error: .dev-ports not found"
    exit 1
  fi

  # shellcheck source=/dev/null
  source "$DEV_PORTS"

  if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
    echo "Error: .dev-ports is missing CONVEX_TEAM and/or CONVEX_PROJECT"
    exit 1
  fi

  # convex dev --configure existing refuses to run if another local backend
  # is active. Check and give a clear error.
  if port_in_use "${CONVEX_CLOUD_PORT:-3210}"; then
    echo "Error: Dev Convex is running on port ${CONVEX_CLOUD_PORT:-3210}."
    echo ""
    echo "Stop it first (Ctrl+C in the convex:local terminal), then re-run:"
    echo "  bun run test:e2e"
    exit 1
  fi

  # Check for stale E2E instance
  if [ -f "$E2E_PID_FILE" ]; then
    local old_pid
    old_pid=$(cat "$E2E_PID_FILE")
    if kill -0 "$old_pid" 2>/dev/null; then
      echo "Error: E2E Convex already running (PID $old_pid). Run 'scripts/e2e-convex.sh stop' first."
      exit 1
    fi
    rm -f "$E2E_PID_FILE"
  fi

  # Find free port pair — start high to avoid dev range (3210+)
  local cloud_port site_port n=0
  while true; do
    cloud_port=$((13210 + n * 2))
    site_port=$((13211 + n * 2))
    if ! port_in_use "$cloud_port" && ! port_in_use "$site_port"; then
      break
    fi
    n=$((n + 1))
    if [ "$n" -gt 50 ]; then
      echo "Error: Could not find free ports for E2E Convex"
      exit 1
    fi
  done

  echo "Starting ephemeral Convex (cloud=$cloud_port, site=$site_port)..."

  # Back up .env.local — convex dev --configure existing overwrites it
  if [ -f "$ENV_LOCAL" ]; then
    cp "$ENV_LOCAL" "$ENV_BACKUP"
  fi

  # Provision: creates deployment on ephemeral ports and deploys functions
  cd "$REPO_ROOT" && bunx convex dev --configure existing \
    --team "$CONVEX_TEAM" \
    --project "$CONVEX_PROJECT" \
    --dev-deployment local \
    --local-cloud-port "$cloud_port" \
    --local-site-port "$site_port" \
    --codegen disable \
    --once

  # .env.local now points to the ephemeral deployment.
  # Start background Convex (reads .env.local for deployment config)
  cd "$REPO_ROOT" && bunx convex dev --local \
    --local-cloud-port "$cloud_port" \
    --local-site-port "$site_port" \
    --codegen disable &
  local bg_pid=$!
  echo "$bg_pid" > "$E2E_PID_FILE"

  # Wait for backend to be ready
  for i in $(seq 1 30); do
    if ! kill -0 "$bg_pid" 2>/dev/null; then
      echo "Error: E2E Convex backend crashed during startup"
      stop_e2e_convex
      exit 1
    fi
    if curl -sf "http://127.0.0.1:$cloud_port" >/dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "Error: Timed out waiting for E2E Convex backend"
      stop_e2e_convex
      exit 1
    fi
    sleep 1
  done

  # Set anonymous auth for E2E
  cd "$REPO_ROOT" && bunx convex env set ALLOW_ANONYMOUS_AUTH 1
  # Set password auth for E2E (password-auth tests)
  cd "$REPO_ROOT" && bunx convex env set ALLOW_PASSWORD_AUTH 1

  # Generate and set INTERNAL_API_SECRET for companion ↔ Convex communication
  E2E_INTERNAL_API_SECRET=$(openssl rand -hex 32)
  cd "$REPO_ROOT" && bunx convex env set INTERNAL_API_SECRET "$E2E_INTERNAL_API_SECRET"

  # Generate JWT keys for @convex-dev/auth (fresh instances don't have them)
  cd "$REPO_ROOT" && bunx @convex-dev/auth --skip-git-check --allow-dirty-git-state

  # Write port config for test-e2e.sh / playwright.config.ts
  cat > "$E2E_PORTS_FILE" <<EOF
E2E_CONVEX_CLOUD_PORT=$cloud_port
E2E_CONVEX_SITE_PORT=$site_port
E2E_INTERNAL_API_SECRET=$E2E_INTERNAL_API_SECRET
EOF

  echo "Ephemeral Convex ready (cloud=$cloud_port, site=$site_port, PID=$bg_pid)"
}

case "$ACTION" in
  start) start_e2e_convex ;;
  stop)  stop_e2e_convex ;;
  *)
    echo "Usage: e2e-convex.sh start|stop"
    exit 1
    ;;
esac
