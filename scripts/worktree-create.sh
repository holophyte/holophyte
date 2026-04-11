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

path_without_node_modules_bins() {
  local part
  local result=""
  while IFS= read -r part; do
    case "$part" in
      */node_modules/.bin) continue ;;
    esac
    if [ -z "$result" ]; then
      result="$part"
    else
      result="$result:$part"
    fi
  done < <(printf '%s' "$PATH" | tr ':' '\n')
  printf '%s' "$result"
}

REAL_PATH="$(path_without_node_modules_bins)"
BUN_BIN="$(PATH="$REAL_PATH" command -v bun || true)"
if [ -z "$BUN_BIN" ]; then
  echo "Error: Could not find Bun outside node_modules/.bin"
  exit 1
fi

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

# Clean up on failure — remove the worktree and branch so the user can retry
# with the same name without manual cleanup.
cleanup() {
  echo "Cleaning up failed worktree..."
  # Kill background Convex if it was started
  if [ -n "${CONVEX_BG_PID:-}" ]; then
    kill "$CONVEX_BG_PID" 2>/dev/null || true
    kill -- -"$CONVEX_BG_PID" 2>/dev/null || true
  fi
  # Kill anything on the allocated Convex ports
  if [ -n "${CONVEX_CLOUD_PORT:-}" ]; then
    lsof -ti "TCP:$CONVEX_CLOUD_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  fi
  if [ -n "${CONVEX_SITE_PORT:-}" ]; then
    lsof -ti "TCP:$CONVEX_SITE_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
  fi
  if [ -n "${CONVEX_ENV_FILE:-}" ]; then
    rm -f "$CONVEX_ENV_FILE"
  fi
  cd "$REPO_ROOT"
  git worktree remove "$WORKTREE_PATH" --force 2>/dev/null || rm -rf "$WORKTREE_PATH"
  git worktree prune 2>/dev/null || true
  git branch -D "$BRANCH" 2>/dev/null || true
}

# Create worktree
echo "Creating worktree at ~/.holophyte-dev/$FEATURE_NAME on branch $BRANCH..."
git worktree add "$WORKTREE_PATH" -b "$BRANCH"

# From this point, failures should clean up the partial worktree
trap cleanup ERR

# Copy .env (shared config). Don't copy .env.local yet — Convex will create it
# during provisioning. Non-Convex vars (API keys, secrets) are appended after.
cp "$REPO_ROOT/.env" "$WORKTREE_PATH/" 2>/dev/null || true

# Save non-Convex vars from .env.local to restore after Convex provisioning
# (convex dev --configure existing overwrites the file)
# Exclude INTERNAL_API_SECRET — a fresh one is generated later in this script.
NON_CONVEX_VARS=""
if [ -f "$REPO_ROOT/.env.local" ]; then
  NON_CONVEX_VARS=$(grep -vE '^(CONVEX_DEPLOYMENT|CONVEX_URL|CONVEX_SITE_URL|INTERNAL_API_SECRET|# Deployment used by|$)' \
    "$REPO_ROOT/.env.local" || true)
fi

# Install dependencies (frozen lockfile avoids modifying bun.lock, which would
# make the worktree dirty and block `bunx @convex-dev/auth` later)
echo "Installing dependencies..."
cd "$WORKTREE_PATH" && "$BUN_BIN" install --frozen-lockfile

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

# Unset CONVEX_DEPLOY_KEY — it overrides --dev-deployment local and silently
# provisions a cloud deployment instead of a local one.
unset CONVEX_DEPLOY_KEY 2>/dev/null || true

# Ensure Convex AI files prompt is suppressed (avoids interactive prompt during
# provisioning). Write convex.json directly — the CLI errors before backend exists.
if [ ! -f "$WORKTREE_PATH/convex.json" ]; then
  echo '{ "aiFiles": { "enabled": false } }' > "$WORKTREE_PATH/convex.json"
fi

echo "Initializing local Convex backend (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
cd "$WORKTREE_PATH" && "$BUN_BIN" x convex dev --configure existing \
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
echo "Starting local Convex for environment setup..."
cd "$WORKTREE_PATH" && "$BUN_BIN" x convex dev --local \
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

CONVEX_ENV_FILE=$(mktemp)

write_convex_env() {
  local key="$1"
  local value="$2"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$value" >> "$CONVEX_ENV_FILE"
}

# Override SITE_URL (a Convex Auth env var) to point at the app server port.
# The app server proxies /api/auth/* to the Convex site port so OAuth callbacks
# work through a single origin (matches what's configured in GitHub/Google OAuth apps).
write_convex_env SITE_URL "http://localhost:$DEV_PORT"
write_convex_env ALLOW_ANONYMOUS_AUTH 1
write_convex_env ALLOW_PASSWORD_AUTH 1

# Generate and set INTERNAL_API_SECRET for companion ↔ Convex communication
INTERNAL_API_SECRET=$(openssl rand -hex 32)
write_convex_env INTERNAL_API_SECRET "$INTERNAL_API_SECRET"
# Store the secret in .env.local (Bun prioritizes .env.local over .env).
# convex-local.sh reads from .env.local first to stay in sync with the server.
ENV_LOCAL_FILE="$WORKTREE_PATH/.env.local"
if [ -f "$ENV_LOCAL_FILE" ] && grep -q '^INTERNAL_API_SECRET=' "$ENV_LOCAL_FILE"; then
  sed -i '' "s|^INTERNAL_API_SECRET=.*|INTERNAL_API_SECRET=$INTERNAL_API_SECRET|" "$ENV_LOCAL_FILE"
else
  echo "INTERNAL_API_SECRET=$INTERNAL_API_SECRET" >> "$ENV_LOCAL_FILE"
fi

# Generate JWT keys for Convex Auth (anonymous + OAuth login).
# Uses jose directly instead of `bunx @convex-dev/auth` — that tool has
# interactive prompts (SITE_URL, dirty tree) that break in automated scripts.
echo "Generating Convex Auth JWT keys..."
JWT_OUTPUT=$(cd "$WORKTREE_PATH" && "$BUN_BIN" --eval '
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
const keys = await generateKeyPair("RS256", { extractable: true });
const priv = (await exportPKCS8(keys.privateKey)).trimEnd().replaceAll("\n", " ");
const pub = await exportJWK(keys.publicKey);
console.log(priv);
console.log(JSON.stringify({ keys: [{ use: "sig", ...pub }] }));
')
JWT_PRIVATE_KEY=$(echo "$JWT_OUTPUT" | head -1)
JWKS=$(echo "$JWT_OUTPUT" | tail -1)
write_convex_env JWT_PRIVATE_KEY "$JWT_PRIVATE_KEY"
write_convex_env JWKS "$JWKS"

# Forward OAuth credentials from main repo's .dev-ports (if present)
if [ -n "${AUTH_GITHUB_ID:-}" ] && [ -n "${AUTH_GITHUB_SECRET:-}" ]; then
  write_convex_env AUTH_GITHUB_ID "$AUTH_GITHUB_ID"
  write_convex_env AUTH_GITHUB_SECRET "$AUTH_GITHUB_SECRET"
fi
if [ -n "${AUTH_GOOGLE_ID:-}" ] && [ -n "${AUTH_GOOGLE_SECRET:-}" ]; then
  write_convex_env AUTH_GOOGLE_ID "$AUTH_GOOGLE_ID"
  write_convex_env AUTH_GOOGLE_SECRET "$AUTH_GOOGLE_SECRET"
fi

echo "Setting environment variables on local Convex..."
cd "$WORKTREE_PATH" && "$BUN_BIN" x convex env set --from-file "$CONVEX_ENV_FILE" --force
rm -f "$CONVEX_ENV_FILE"

# Seed dev user for email+password auth (idempotent)
cd "$WORKTREE_PATH" && "$BUN_BIN" run seed:dev-user || echo "Warning: Could not seed dev user"

# Stop the background Convex backend (kill process group + port fallback,
# because `bunx` spawns child processes that outlive the wrapper)
kill "$CONVEX_BG_PID" 2>/dev/null || true
kill -- -"$CONVEX_BG_PID" 2>/dev/null || true
wait "$CONVEX_BG_PID" 2>/dev/null || true
# Fallback: kill anything still listening on the Convex ports
lsof -ti "TCP:$CONVEX_CLOUD_PORT" 2>/dev/null | xargs kill 2>/dev/null || true
lsof -ti "TCP:$CONVEX_SITE_PORT" 2>/dev/null | xargs kill 2>/dev/null || true

# Disable the cleanup trap — we succeeded
trap - ERR

echo ""
echo "Worktree created: ~/.holophyte-dev/$FEATURE_NAME"
echo "Ports: dev=$DEV_PORT, convex=$CONVEX_CLOUD_PORT/$CONVEX_SITE_PORT"
echo ""
echo "To start dev:"
echo "  cd ~/.holophyte-dev/$FEATURE_NAME"
echo "  bun run dev:local"
