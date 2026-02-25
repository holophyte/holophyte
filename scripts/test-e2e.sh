#!/usr/bin/env bash
set -euo pipefail

# Pre-flight checks before running Playwright E2E tests

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"

# Read .dev-ports
if [ ! -f "$DEV_PORTS" ]; then
  echo "Error: .dev-ports not found — run from a project root with local Convex configured"
  exit 1
fi

# shellcheck source=/dev/null
source "$DEV_PORTS"

CONVEX_PORT="${CONVEX_CLOUD_PORT:-3210}"

# Check if Convex is running
if ! lsof -iTCP:"$CONVEX_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Error: Local Convex backend is not running on port $CONVEX_PORT"
  echo ""
  echo "Start it first:"
  echo "  bun run convex:local"
  echo ""
  echo "Then re-run:"
  echo "  bun run test:e2e"
  exit 1
fi

# Check ALLOW_ANONYMOUS_AUTH is set
AUTH_CHECK=$(cd "$REPO_ROOT" && bunx convex env get ALLOW_ANONYMOUS_AUTH 2>&1 || true)
if [[ "$AUTH_CHECK" != *"1"* ]]; then
  echo "Setting ALLOW_ANONYMOUS_AUTH=1 on local Convex..."
  cd "$REPO_ROOT" && bunx convex env set ALLOW_ANONYMOUS_AUTH 1
fi

# Run Playwright
exec bunx playwright test "$@"
