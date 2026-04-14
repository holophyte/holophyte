#!/usr/bin/env bash
set -euo pipefail

# Clean up a git worktree and its associated branch

FEATURE_NAME="${1:-}"

if [ -z "$FEATURE_NAME" ]; then
  echo "Usage: bun run worktree:cleanup <feature-name>"
  echo "       bun run worktree:cleanup --list"
  echo "       bun run worktree:cleanup --stale"
  echo ""
  echo "Options:"
  echo "  --list   List all worktrees and their status"
  echo "  --stale  Remove worktrees whose directories no longer exist"
  exit 1
fi

# Sanitize feature name (same rules as worktree:create) to prevent path traversal
if [ "$FEATURE_NAME" != "--list" ] && [ "$FEATURE_NAME" != "--stale" ] && [[ ! "$FEATURE_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: Feature name must contain only letters, numbers, hyphens, and underscores"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_DIR="$HOME/.holophyte-dev"

# --list: show all worktrees with status
if [ "$FEATURE_NAME" = "--list" ]; then
  echo "Worktrees:"
  git worktree list | while read -r path commit branch; do
    if [ "$path" = "$(git rev-parse --show-toplevel)" ]; then
      continue
    fi
    name=$(basename "$path")
    if [ -d "$path" ]; then
      has_ports="no ports"
      if [ -f "$path/.dev-ports" ]; then
        has_ports=$(grep '^DEV_PORT=' "$path/.dev-ports" | cut -d= -f2)
        has_ports="port $has_ports"
      fi
      echo "  $name  ${branch//[\[\]]/}  ($has_ports)"
    else
      echo "  $name  ${branch//[\[\]]/}  (STALE — directory missing)"
    fi
  done
  exit 0
fi

# --stale: prune worktrees whose directories are gone
if [ "$FEATURE_NAME" = "--stale" ]; then
  echo "Pruning stale worktree entries..."
  git worktree prune -v
  echo "Done."
  exit 0
fi

WORKTREE_PATH="$WORKTREE_DIR/$FEATURE_NAME"
BRANCH="feat/$FEATURE_NAME"

# Check if the worktree or branch exists
WORKTREE_EXISTS=false
BRANCH_EXISTS=false
DIR_EXISTS=false

if git worktree list --porcelain | grep -q "worktree $WORKTREE_PATH"; then
  WORKTREE_EXISTS=true
fi

if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  BRANCH_EXISTS=true
fi

if [ -d "$WORKTREE_PATH" ]; then
  DIR_EXISTS=true
fi

if [ "$WORKTREE_EXISTS" = false ] && [ "$BRANCH_EXISTS" = false ] && [ "$DIR_EXISTS" = false ]; then
  echo "Nothing to clean up — no worktree, branch, or directory found for '$FEATURE_NAME'"
  exit 0
fi

echo "Cleaning up '$FEATURE_NAME'..."

# Run from the main repo root so the shell isn't inside a deleted directory
cd "$REPO_ROOT"

# Kill any processes running in this worktree (dev server, `bunx convex dev`
# wrapper, convex backend, etc). Matching by path catches everything whose
# command line references the worktree, not just the port listener. SIGKILL
# avoids shutdown sequences that try to re-read package.json after the
# worktree is removed and spam errors back to the terminal.
#
# Anchor the match with a trailing `/` so sibling worktrees with shared
# prefixes (e.g. cleaning `foo` doesn't match `foo2`) aren't killed. Escape
# regex metacharacters in the path so `.holophyte-dev` doesn't match `X`.
ESCAPED_PATH="${WORKTREE_PATH//./\\.}"
pgrep -f "${ESCAPED_PATH}/" 2>/dev/null | xargs kill -9 2>/dev/null || true

# Fallback: anything still holding the worktree's Convex ports
if [ -f "$WORKTREE_PATH/.dev-ports" ]; then
  # shellcheck source=/dev/null
  source "$WORKTREE_PATH/.dev-ports"
  for port in "${CONVEX_CLOUD_PORT:-}" "${CONVEX_SITE_PORT:-}"; do
    [ -n "$port" ] && lsof -ti "TCP:$port" 2>/dev/null | xargs kill -9 2>/dev/null || true
  done
fi

# Remove the git worktree (handles both clean and dirty states)
if [ "$WORKTREE_EXISTS" = true ]; then
  echo "  Removing git worktree..."
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || true
fi

# Remove the directory if it still exists (e.g., worktree was already pruned)
if [ -d "$WORKTREE_PATH" ]; then
  echo "  Removing directory..."
  rm -rf "$WORKTREE_PATH"
fi

# Prune stale worktree entries
git worktree prune 2>/dev/null || true

# Delete the branch
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "  Deleting branch $BRANCH..."
  git branch -D "$BRANCH" 2>/dev/null || true
fi

echo "Done."
