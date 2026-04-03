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
      echo "  $name  $branch  ($has_ports)"
    else
      echo "  $name  $branch  (STALE — directory missing)"
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

# Kill any Convex processes running on this worktree's ports
if [ -f "$WORKTREE_PATH/.dev-ports" ]; then
  # shellcheck source=/dev/null
  source "$WORKTREE_PATH/.dev-ports"
  for port in "${CONVEX_CLOUD_PORT:-}" "${CONVEX_SITE_PORT:-}"; do
    [ -n "$port" ] && lsof -ti "TCP:$port" 2>/dev/null | xargs kill 2>/dev/null || true
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
