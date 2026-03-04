#!/usr/bin/env bash
set -euo pipefail

# Run E2E tests in an isolated worktree — allows E2E to run without
# stopping dev Convex or touching the main repo's .env.local.
#
# Usage: bun run test:e2e:isolated [playwright args...]
# Example: bun run test:e2e:isolated --grep "create task"
#
# Creates a temporary worktree, installs deps, runs tests, then tears
# everything down. The main repo stays untouched.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MAIN_DEV_PORTS="$REPO_ROOT/.dev-ports"

if [ ! -f "$MAIN_DEV_PORTS" ]; then
  echo "Error: .dev-ports not found in main repo"
  exit 1
fi

# shellcheck source=/dev/null
source "$MAIN_DEV_PORTS"

if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
  echo "Error: .dev-ports is missing CONVEX_TEAM and/or CONVEX_PROJECT"
  exit 1
fi

# Create temp worktree (detached HEAD — no branch needed)
WORKTREE_NAME="e2e-$(date +%s)-$$"
WORKTREE_DIR="$HOME/.holophyte-dev"
WORKTREE_PATH="$WORKTREE_DIR/$WORKTREE_NAME"

mkdir -p "$WORKTREE_DIR"
echo "Creating temporary worktree for E2E tests..."
git worktree add --detach "$WORKTREE_PATH" HEAD

# Always clean up on exit (Ctrl+C, test failure, etc.)
cleanup() {
  echo ""
  echo "Cleaning up E2E worktree..."
  # Stop any ephemeral Convex in the worktree
  "$WORKTREE_PATH/scripts/e2e-convex.sh" stop 2>/dev/null || true
  # Remove worktree
  git worktree remove --force "$WORKTREE_PATH" 2>/dev/null || true
  echo "E2E worktree removed."
}
trap cleanup EXIT

# Copy .env (shared config — API keys, secrets)
cp "$REPO_ROOT/.env" "$WORKTREE_PATH/" 2>/dev/null || true

# Write .dev-ports with team/project info and high dummy ports.
# DEV_PORT won't be used — playwright.config.ts resolves its own E2E port.
# CONVEX_CLOUD_PORT is set high so e2e-convex.sh's "is dev Convex running?"
# check passes (these ports won't actually be in use).
cat > "$WORKTREE_PATH/.dev-ports" <<EOF
DEV_PORT=28080
CONVEX_CLOUD_PORT=23210
CONVEX_SITE_PORT=23211
CONVEX_TEAM=$CONVEX_TEAM
CONVEX_PROJECT=$CONVEX_PROJECT
EOF

# Install dependencies and copy Convex generated types
echo "Installing dependencies..."
cd "$WORKTREE_PATH" && bun install --frozen-lockfile
echo "Copying Convex generated types..."
cp -r "$REPO_ROOT/convex/_generated" "$WORKTREE_PATH/convex/_generated"

# Run E2E tests — capture exit code to return after cleanup
echo ""
echo "Running E2E tests in isolated worktree..."
echo ""
E2E_EXIT=0
cd "$WORKTREE_PATH" && "$WORKTREE_PATH/scripts/test-e2e.sh" "$@" || E2E_EXIT=$?

exit "$E2E_EXIT"
