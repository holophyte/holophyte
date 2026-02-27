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

# Copy .env (shared config). Don't copy .env.local yet — Convex will create it
# during provisioning. Non-Convex vars (API keys, secrets) are appended after.
cp "$REPO_ROOT/.env" "$WORKTREE_PATH/" 2>/dev/null || true

# Save non-Convex vars from .env.local to restore after Convex provisioning
# (convex dev --configure existing overwrites the file)
NON_CONVEX_VARS=""
if [ -f "$REPO_ROOT/.env.local" ]; then
  NON_CONVEX_VARS=$(grep -vE '^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL|# Deployment used by|$)' \
    "$REPO_ROOT/.env.local" || true)
fi

# Install dependencies
echo "Installing dependencies..."
cd "$WORKTREE_PATH" && bun install

# Assign ports — scan all existing .dev-ports files to avoid collisions with
# other worktrees, even if they aren't currently running.
port_in_use() {
  lsof -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

# Collect DEV_PORTs already allocated to main repo and other worktrees
allocated_dev_ports() {
  for dp in "$REPO_ROOT/.dev-ports" "$WORKTREE_DIR"/*/.dev-ports; do
    [ -f "$dp" ] || continue
    grep '^DEV_PORT=' "$dp" 2>/dev/null | cut -d= -f2
  done
}

# Start scanning from slot 1 (slot 0 is main repo @ 8080)
ALLOCATED=$(allocated_dev_ports)
N=1
while true; do
  DEV_PORT=$((8080 + N * 2))
  CONVEX_CLOUD_PORT=$((3210 + N * 2))
  CONVEX_SITE_PORT=$((3211 + N * 2))
  E2E_PORT=$((DEV_PORT + 1))

  # Skip if this slot's DEV_PORT is already allocated to another worktree
  if echo "$ALLOCATED" | grep -qx "$DEV_PORT"; then
    N=$((N + 1))
    continue
  fi

  # Skip if any port in this slot is currently in use
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

echo "Initializing local Convex backend (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
cd "$WORKTREE_PATH" && bunx convex dev --configure existing \
  --team "$CONVEX_TEAM" \
  --project "$CONVEX_PROJECT" \
  --dev-deployment local \
  --local-cloud-port "$CONVEX_CLOUD_PORT" \
  --local-site-port "$CONVEX_SITE_PORT" \
  --once

# Restore non-Convex vars (API keys, secrets) that Convex overwrote
if [ -n "$NON_CONVEX_VARS" ]; then
  printf '\n%s\n' "$NON_CONVEX_VARS" >> "$WORKTREE_PATH/.env.local"
fi

# Auth keys are configured on first `bun run dev:local` (needs a running backend)

# `convex dev --once` exits after deploying, but `convex env set` needs a
# running backend. Start one in the background, set env vars, then stop it.
echo "Setting environment variables on local Convex..."
cd "$WORKTREE_PATH" && bunx convex dev --local \
  --local-cloud-port "$CONVEX_CLOUD_PORT" \
  --local-site-port "$CONVEX_SITE_PORT" &
CONVEX_BG_PID=$!

# Wait for the backend to be ready
for i in $(seq 1 30); do
  if ! kill -0 "$CONVEX_BG_PID" 2>/dev/null; then
    echo "Warning: Convex backend crashed — env vars may not be set"
    break
  fi
  if curl -sf "http://127.0.0.1:$CONVEX_CLOUD_PORT" >/dev/null 2>&1; then
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Warning: Timed out waiting for Convex backend — env vars may not be set"
    kill "$CONVEX_BG_PID" 2>/dev/null || true
    break
  fi
  sleep 1
done

# Override SITE_URL to point at the app server port. The app server proxies
# /api/auth/* to the Convex site port so OAuth callbacks work through a single
# origin (matches what's configured in GitHub/Google OAuth apps).
cd "$WORKTREE_PATH" && bunx convex env set SITE_URL "http://localhost:$DEV_PORT"
cd "$WORKTREE_PATH" && bunx convex env set ALLOW_ANONYMOUS_AUTH 1

# Generate and set INTERNAL_API_SECRET for companion ↔ Convex communication
INTERNAL_API_SECRET=$(openssl rand -hex 32)
cd "$WORKTREE_PATH" && bunx convex env set INTERNAL_API_SECRET "$INTERNAL_API_SECRET"
echo "INTERNAL_API_SECRET=$INTERNAL_API_SECRET" >> "$WORKTREE_PATH/.env"

# Generate JWT keys for Convex Auth (anonymous + OAuth login)
echo "Setting up Convex Auth keys..."
cd "$WORKTREE_PATH" && bunx @convex-dev/auth 2>&1 | grep -E '(Successfully set|already)'

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

# Stop the background Convex backend
kill "$CONVEX_BG_PID" 2>/dev/null || true
wait "$CONVEX_BG_PID" 2>/dev/null || true

echo ""
echo "Worktree created: ~/.holophyte-dev/$FEATURE_NAME"
echo "Ports: dev=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"
echo ""
echo "To start dev:"
echo "  cd ~/.holophyte-dev/$FEATURE_NAME"
echo "  bun run dev:local"
