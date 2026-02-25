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
WORKTREE_DIR="$HOME/.holophyte-dev"
WORKTREE_PATH="$WORKTREE_DIR/$FEATURE_NAME"
BRANCH="feat/$FEATURE_NAME"

# Read team/project from main repo's .dev-ports
MAIN_DEV_PORTS="$REPO_ROOT/.dev-ports"
if [ ! -f "$MAIN_DEV_PORTS" ]; then
  echo "Error: .dev-ports not found in main repo ($MAIN_DEV_PORTS)"
  exit 1
fi

# shellcheck source=/dev/null
source "$MAIN_DEV_PORTS"

if [ -z "${CONVEX_TEAM:-}" ] || [ -z "${CONVEX_PROJECT:-}" ]; then
  echo "Error: .dev-ports is missing CONVEX_TEAM and CONVEX_PROJECT"
  exit 1
fi

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

# Ensure worktree directory exists
mkdir -p "$WORKTREE_DIR"

# Create worktree
echo "Creating worktree at ~/.holophyte-dev/$FEATURE_NAME on branch $BRANCH..."
git worktree add "$WORKTREE_PATH" -b "$BRANCH"

# Copy env files — .env.local gives Convex the project context so
# `convex dev --local` can skip the interactive setup prompt
cp "$REPO_ROOT/.env" "$WORKTREE_PATH/" 2>/dev/null || true
cp "$REPO_ROOT/.env.local" "$WORKTREE_PATH/" 2>/dev/null || true

# Install dependencies
echo "Installing dependencies..."
cd "$WORKTREE_PATH" && bun install

# Assign ports — start from worktree count, bump if any port is already in use
port_in_use() {
  lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

N=$(git worktree list | wc -l | tr -d ' ')
while true; do
  DEV_PORT=$((8080 + (N - 1) * 2))
  CONVEX_CLOUD_PORT=$((3210 + (N - 1) * 2))
  CONVEX_SITE_PORT=$((3211 + (N - 1) * 2))

  E2E_PORT=$((DEV_PORT + 1))
  if ! port_in_use "$DEV_PORT" && ! port_in_use "$E2E_PORT" && ! port_in_use "$CONVEX_CLOUD_PORT" && ! port_in_use "$CONVEX_SITE_PORT"; then
    break
  fi
  echo "Ports for slot $N in use, trying next..."
  N=$((N + 1))
done

# Write .dev-ports (inherit team/project from main repo)
cat > "$WORKTREE_PATH/.dev-ports" <<EOF
DEV_PORT=$DEV_PORT
CONVEX_CLOUD_PORT=$CONVEX_CLOUD_PORT
CONVEX_SITE_PORT=$CONVEX_SITE_PORT
CONVEX_TEAM=$CONVEX_TEAM
CONVEX_PROJECT=$CONVEX_PROJECT
EOF

# Initialize local Convex — always use --configure existing since the copied
# .env.local may have cloud deployment, and we need a fresh local instance
echo "Initializing local Convex backend (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
cd "$WORKTREE_PATH" && bunx convex dev --configure existing \
  --team "$CONVEX_TEAM" \
  --project "$CONVEX_PROJECT" \
  --dev-deployment local \
  --local-cloud-port "$CONVEX_CLOUD_PORT" \
  --local-site-port "$CONVEX_SITE_PORT" \
  --once

# Set up Convex Auth JWT keys for the local deployment
echo "Configuring Convex Auth keys..."
cd "$WORKTREE_PATH" && bunx @convex-dev/auth

# Override SITE_URL to point at the app server port. The app server proxies
# /api/auth/* to the Convex site port so OAuth callbacks work through a single
# origin (matches what's configured in GitHub/Google OAuth apps).
echo "Setting SITE_URL to app server (http://localhost:$DEV_PORT)..."
cd "$WORKTREE_PATH" && bunx convex env set SITE_URL "http://localhost:$DEV_PORT"
cd "$WORKTREE_PATH" && bunx convex env set ALLOW_ANONYMOUS_AUTH 1

# Forward OAuth credentials from main repo's .dev-ports (if present)
if [ -n "${AUTH_GITHUB_ID:-}" ] && [ -n "${AUTH_GITHUB_SECRET:-}" ]; then
  echo "Setting GitHub OAuth credentials..."
  cd "$WORKTREE_PATH" && bunx convex env set AUTH_GITHUB_ID "$AUTH_GITHUB_ID"
  cd "$WORKTREE_PATH" && bunx convex env set AUTH_GITHUB_SECRET "$AUTH_GITHUB_SECRET"
fi
if [ -n "${AUTH_GOOGLE_ID:-}" ] && [ -n "${AUTH_GOOGLE_SECRET:-}" ]; then
  echo "Setting Google OAuth credentials..."
  cd "$WORKTREE_PATH" && bunx convex env set AUTH_GOOGLE_ID "$AUTH_GOOGLE_ID"
  cd "$WORKTREE_PATH" && bunx convex env set AUTH_GOOGLE_SECRET "$AUTH_GOOGLE_SECRET"
fi

echo ""
echo "Worktree created: ~/.holophyte-dev/$FEATURE_NAME"
echo "Ports: dev=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"
echo ""
echo "To start dev:"
echo "  cd ~/.holophyte-dev/$FEATURE_NAME"
echo "  bun run dev:local"
