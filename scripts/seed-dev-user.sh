#!/usr/bin/env bash
set -euo pipefail

# Seed a dev user (dev@localhost / password) for local development.
# Requires a running local Convex backend with the Password provider deployed.
#
# Usage:
#   bun run seed:dev-user                       # reads ports from .dev-ports
#   CONVEX_URL=http://... bun run seed:dev-user  # explicit URL

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"

# Resolve the Convex URL
if [ -z "${CONVEX_URL:-}" ]; then
  if [ -f "$DEV_PORTS" ]; then
    # shellcheck source=/dev/null
    source "$DEV_PORTS"
    export CONVEX_URL="http://127.0.0.1:${CONVEX_CLOUD_PORT}"
  else
    echo "Error: No CONVEX_URL and no .dev-ports found" >&2
    exit 1
  fi
fi

# Safety guard: only seed against local backends
if [[ "$CONVEX_URL" != http://127.0.0.1:* && "$CONVEX_URL" != http://localhost:* ]]; then
  echo "Error: seed:dev-user is for local backends only (got $CONVEX_URL)" >&2
  exit 1
fi

# Use a small inline Bun script to call the Convex auth action.
# The Password provider's sign-up flow goes through the Convex action system
# (not an HTTP endpoint), so we need a real Convex client.
bun -e "
import { ConvexHttpClient } from 'convex/browser';
const client = new ConvexHttpClient(process.env.CONVEX_URL);
try {
  await client.action('auth:signIn', {
    provider: 'password',
    params: { flow: 'signUp', email: 'dev@localhost', password: 'password' },
  });
  console.log('Dev user seeded: dev@localhost / password');
} catch (e) {
  const msg = String(e);
  if (msg.includes('already exists')) {
    console.log('Dev user already exists: dev@localhost');
  } else {
    console.error('Warning: Could not seed dev user:', msg);
    console.error('You can create one manually via the sign-up form.');
    process.exit(1);
  }
}
"
