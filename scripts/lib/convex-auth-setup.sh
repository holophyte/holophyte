#!/usr/bin/env bash
# Shared Convex Auth setup — configures JWT keys, SITE_URL, feature flags,
# and (optionally) seeds the dev user on a running local Convex backend.
#
# Sourced by both scripts/worktree-create.sh and scripts/e2e-convex.sh.
# Keep the two flows in sync by editing THIS file rather than forking
# auth logic back into the callers.
#
# Caller contract:
#   - Must `cd` into the target worktree/repo (so `convex env` targets
#     the deployment from its local .env.local).
#   - Must source scripts/lib/resolve-bun.sh first so BUN_BIN is set.
#   - Must have a running local Convex backend (provisioned and listening).
#   - Must export SITE_URL (the app server URL Convex Auth should trust
#     for OAuth callbacks).
#
# Optional env inputs (with defaults):
#   INTERNAL_API_SECRET       — reused if set; generated otherwise
#   ALLOW_ANONYMOUS_AUTH=1
#   ALLOW_PASSWORD_AUTH=1
#   SEED_DEV_USER=1           — set to 0 to skip
#   AUTH_GITHUB_ID/SECRET     — forwarded if both set
#   AUTH_GOOGLE_ID/SECRET     — forwarded if both set
#
# Exports on success:
#   INTERNAL_API_SECRET       — final value (input or generated)

_cas_write_env() {
  local file="$1"
  local key="$2"
  local value="$3"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '%s="%s"\n' "$key" "$value" >> "$file"
}

setup_convex_auth() {
  if [ -z "${BUN_BIN:-}" ]; then
    echo "setup_convex_auth: BUN_BIN must be set (source lib/resolve-bun.sh first)" >&2
    return 1
  fi
  if [ -z "${SITE_URL:-}" ]; then
    echo "setup_convex_auth: SITE_URL must be exported before calling" >&2
    return 1
  fi

  : "${ALLOW_ANONYMOUS_AUTH:=1}"
  : "${ALLOW_PASSWORD_AUTH:=1}"
  : "${SEED_DEV_USER:=1}"

  if [ -z "${INTERNAL_API_SECRET:-}" ]; then
    INTERNAL_API_SECRET=$(openssl rand -hex 32)
  fi
  export INTERNAL_API_SECRET

  # Generate JWT keys for Convex Auth (anonymous + OAuth login).
  # Uses `jose` directly — `bunx @convex-dev/auth` has interactive prompts
  # (SITE_URL confirm, dirty tree warning) that break in automated scripts.
  echo "Generating Convex Auth JWT keys..."
  local jwt_output priv jwks
  jwt_output=$("$BUN_BIN" --eval '
import { generateKeyPair, exportPKCS8, exportJWK } from "jose";
const keys = await generateKeyPair("RS256", { extractable: true });
const priv = (await exportPKCS8(keys.privateKey)).trimEnd().replaceAll("\n", " ");
const pub = await exportJWK(keys.publicKey);
console.log(priv);
console.log(JSON.stringify({ keys: [{ use: "sig", ...pub }] }));
')
  priv=$(echo "$jwt_output" | head -1)
  jwks=$(echo "$jwt_output" | tail -1)

  local env_file
  env_file=$(mktemp)

  _cas_write_env "$env_file" SITE_URL "$SITE_URL"
  _cas_write_env "$env_file" ALLOW_ANONYMOUS_AUTH "$ALLOW_ANONYMOUS_AUTH"
  _cas_write_env "$env_file" ALLOW_PASSWORD_AUTH "$ALLOW_PASSWORD_AUTH"
  _cas_write_env "$env_file" INTERNAL_API_SECRET "$INTERNAL_API_SECRET"
  _cas_write_env "$env_file" JWT_PRIVATE_KEY "$priv"
  _cas_write_env "$env_file" JWKS "$jwks"

  if [ -n "${AUTH_GITHUB_ID:-}" ] && [ -n "${AUTH_GITHUB_SECRET:-}" ]; then
    _cas_write_env "$env_file" AUTH_GITHUB_ID "$AUTH_GITHUB_ID"
    _cas_write_env "$env_file" AUTH_GITHUB_SECRET "$AUTH_GITHUB_SECRET"
  fi
  if [ -n "${AUTH_GOOGLE_ID:-}" ] && [ -n "${AUTH_GOOGLE_SECRET:-}" ]; then
    _cas_write_env "$env_file" AUTH_GOOGLE_ID "$AUTH_GOOGLE_ID"
    _cas_write_env "$env_file" AUTH_GOOGLE_SECRET "$AUTH_GOOGLE_SECRET"
  fi

  echo "Setting environment variables on local Convex..."
  "$BUN_BIN" x convex env set --from-file "$env_file" --force
  rm -f "$env_file"

  if [ "$SEED_DEV_USER" = "1" ]; then
    # `convex env set` above causes a background `convex dev` wrapper (if any)
    # to re-push functions, briefly taking the backend offline. Retry the seed
    # so we tolerate that window without flakiness.
    local seed_attempt
    for seed_attempt in 1 2 3 4 5; do
      if "$BUN_BIN" run seed:dev-user; then
        break
      fi
      if [ "$seed_attempt" = "5" ]; then
        echo "Warning: Could not seed dev user after $seed_attempt attempts"
        break
      fi
      sleep 1
    done
  fi
}
