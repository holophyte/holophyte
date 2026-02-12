#!/usr/bin/env bash
set -euo pipefail

# Create a new git worktree with isolated local Convex ports

FEATURE_NAME="${1:-}"

if [ -z "$FEATURE_NAME" ]; then
  echo "Usage: bun run worktree:create <feature-name>"
  echo "Example: bun run worktree:create my-feature"
  exit 1
fi

# Sanitize feature name — only allow alphanumeric, hyphens, underscores
if [[ ! "$FEATURE_NAME" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "Error: Feature name must contain only letters, numbers, hyphens, and underscores"
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO="$(basename "$REPO_ROOT")"
WORKTREE_PATH="$REPO_ROOT/../$REPO-$FEATURE_NAME"
BRANCH="feat/$FEATURE_NAME"

# Check if branch already exists
if git rev-parse --verify "$BRANCH" >/dev/null 2>&1; then
  echo "Error: Branch '$BRANCH' already exists"
  exit 1
fi

# Check if worktree path already exists
if [ -d "$WORKTREE_PATH" ]; then
  echo "Error: Directory '$WORKTREE_PATH' already exists"
  exit 1
fi

# Create worktree
echo "Creating worktree at ../$REPO-$FEATURE_NAME on branch $BRANCH..."
git worktree add "$WORKTREE_PATH" -b "$BRANCH"

# Copy .env (NOT .env.local — each worktree gets its own from convex init)
cp "$REPO_ROOT/.env" "$WORKTREE_PATH/" 2>/dev/null || true

# Install dependencies
echo "Installing dependencies..."
cd "$WORKTREE_PATH" && bun install

# Assign ports based on worktree count
# N = total worktrees including main (so first worktree is N=2)
N=$(git worktree list | wc -l | tr -d ' ')
DEV_PORT=$((8080 + N - 1))
CONVEX_CLOUD_PORT=$((3210 + (N - 1) * 2))
CONVEX_SITE_PORT=$((3211 + (N - 1) * 2))

# Write .dev-ports
cat > "$WORKTREE_PATH/.dev-ports" <<EOF
DEV_PORT=$DEV_PORT
CONVEX_CLOUD_PORT=$CONVEX_CLOUD_PORT
CONVEX_SITE_PORT=$CONVEX_SITE_PORT
EOF

echo ""
echo "Worktree created: ../$REPO-$FEATURE_NAME"
echo "Ports: dev=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"
echo ""
echo "To start dev:"
echo "  cd ../$REPO-$FEATURE_NAME"
echo "  bun run dev:local"
echo ""
echo "On first run, Convex will prompt to create a new project (one-time setup)."
