#!/usr/bin/env bash
set -euo pipefail

# Start local Convex backend using ports from .dev-ports

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_PORTS="$REPO_ROOT/.dev-ports"

if [ ! -f "$DEV_PORTS" ]; then
  echo "Error: .dev-ports file not found at $DEV_PORTS"
  echo ""
  echo "Create it with:"
  echo "  DEV_PORT=8080"
  echo "  CONVEX_CLOUD_PORT=3210"
  echo "  CONVEX_SITE_PORT=3211"
  exit 1
fi

# shellcheck source=/dev/null
source "$DEV_PORTS"

if ! [[ "${CONVEX_CLOUD_PORT:-}" =~ ^[0-9]+$ ]] || \
   ! [[ "${CONVEX_SITE_PORT:-}" =~ ^[0-9]+$ ]]; then
  echo "Error: .dev-ports is missing required variables (CONVEX_CLOUD_PORT, CONVEX_SITE_PORT)"
  exit 1
fi

echo "Starting local Convex (cloud=$CONVEX_CLOUD_PORT, site=$CONVEX_SITE_PORT)..."
bunx convex dev --local \
  --local-cloud-port "$CONVEX_CLOUD_PORT" \
  --local-site-port "$CONVEX_SITE_PORT"
