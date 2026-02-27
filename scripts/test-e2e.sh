#!/usr/bin/env bash
set -euo pipefail

# Run Playwright E2E tests with an ephemeral Convex backend.
# No manual setup needed — spins up a fresh Convex instance, runs tests,
# then tears it down. Each run gets a clean database.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Ensure cleanup on exit (Ctrl+C, test failure, etc.)
cleanup() {
  "$SCRIPT_DIR/e2e-convex.sh" stop 2>/dev/null || true
}
trap cleanup EXIT

# Start ephemeral Convex
"$SCRIPT_DIR/e2e-convex.sh" start

# Read the ephemeral ports
# shellcheck source=/dev/null
source "$REPO_ROOT/.e2e-convex-ports"

# Export for playwright.config.ts to pick up
export E2E_CONVEX_CLOUD_PORT
export E2E_CONVEX_SITE_PORT
export E2E_INTERNAL_API_SECRET

# Run Playwright
cd "$REPO_ROOT" && bunx playwright test "$@"
