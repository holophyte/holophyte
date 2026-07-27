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

# Resolve real Bun binary (skips node_modules/.bin shim) and export clean PATH
# shellcheck source=lib/resolve-bun.sh
source "$SCRIPT_DIR/lib/resolve-bun.sh"
# shellcheck source=lib/convex-auth-setup.sh
source "$SCRIPT_DIR/lib/convex-auth-setup.sh"

E2E_PID_FILE="$REPO_ROOT/.e2e-convex.pid"
E2E_PORTS_FILE="$REPO_ROOT/.e2e-convex-ports"
ENV_LOCAL="$REPO_ROOT/.env.local"
ENV_BACKUP="$REPO_ROOT/.env.local.dev-backup"

check_dependencies() {
  if ! command -v lsof >/dev/null 2>&1; then
    echo "Error: lsof is required for port detection but not found."
    echo "Install it: sudo apt-get install -y lsof (Linux) or brew install lsof (macOS)"
    exit 1
  fi
}

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
  check_dependencies

  # Source .dev-ports if it exists (local dev), otherwise rely on env vars (CI)
  if [ -f "$DEV_PORTS" ]; then
    # shellcheck source=/dev/null
    source "$DEV_PORTS"
  fi

  # Check that dev Convex isn't already running — the CLI refuses to
  # provision when another local backend is active.
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

  # Unset credentials that override local mode
  unset CONVEX_DEPLOY_KEY 2>/dev/null || true

  # Enable anonymous local development — skips login prompts in CI.
  export CONVEX_AGENT_MODE=anonymous

  # Back up .env.local and clear it plus CONVEX_DEPLOYMENT.
  # Convex 1.42+ anonymous path (per CLI tip): "clear CONVEX_DEPLOYMENT to try
  # without creating an account." Both --configure new and a pre-written
  # CONVEX_DEPLOYMENT=local:* trigger the Device name auth prompt; neither
  # CONVEX_AGENT_MODE=anonymous nor pre-writing .env.local suppresses it.
  # With CONVEX_DEPLOYMENT unset and no --configure, convex dev auto-provisions
  # a fresh anonymous local backend without any authentication.
  if [ -f "$ENV_LOCAL" ]; then
    cp "$ENV_LOCAL" "$ENV_BACKUP"
  fi
  rm -f "$ENV_LOCAL"
  unset CONVEX_DEPLOYMENT

  # Deploy functions synchronously in anonymous mode (no --configure, no
  # CONVEX_DEPLOYMENT — convex dev auto-creates an anonymous local deployment).
  cd "$REPO_ROOT" && bunx convex dev \
    --local-cloud-port "$cloud_port" \
    --local-site-port "$site_port" \
    --codegen disable \
    --once

  # Start background Convex (reads .env.local for deployment config)
  cd "$REPO_ROOT" && bunx convex dev \
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

  # Configure Convex Auth (JWT keys, SITE_URL, feature flags, dev user).
  # Shared with scripts/worktree-create.sh via scripts/lib/convex-auth-setup.sh.
  # Derive SITE_URL from the app server port used by Playwright
  # (DEV_PORT+1, matching resolveE2ePort() in playwright.config.ts).
  local e2e_port
  e2e_port=$(( ${DEV_PORT:-8080} + 1 ))
  cd "$REPO_ROOT"
  # Override CONVEX_URL so seed:dev-user hits the ephemeral backend rather
  # than the (dummy, high-numbered) CONVEX_CLOUD_PORT from the worktree's
  # .dev-ports — the latter is never actually listening in isolated mode.
  export CONVEX_URL="http://127.0.0.1:$cloud_port"
  export SITE_URL="http://localhost:$e2e_port"
  setup_convex_auth

  # Expose the generated secret to Playwright via .e2e-convex-ports
  local E2E_INTERNAL_API_SECRET="$INTERNAL_API_SECRET"

  # Seed the dev user so AutoTestAuth always signs in (not signs up).
  # Tests start with empty storage state and sign in fresh per test — seeding
  # here ensures the user exists before global-setup or any test runs.
  CONVEX_URL="http://127.0.0.1:$cloud_port" bash "$SCRIPT_DIR/seed-dev-user.sh"

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
