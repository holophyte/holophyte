#!/usr/bin/env bash
# Start the companion app connected to a Convex preview backend.
#
# Usage:
#   bun run companion:preview                    # uses current git branch
#   bun run companion:preview feat/my-feature    # explicit branch name
set -euo pipefail

BRANCH="${1:-$(git rev-parse --abbrev-ref HEAD)}"

# Derive preview name using the same logic as build.ts
SANITIZED=$(echo "$BRANCH" | sed 's/[^a-zA-Z0-9-]/-/g' | cut -c1-50)
SUFFIX=$(echo -n "$BRANCH" | shasum -a 1 | cut -c1-7)
PREVIEW_NAME="${SANITIZED}-${SUFFIX}"

echo "Looking up preview backend: $PREVIEW_NAME"

# Clear local Convex deployment if it's a local backend — the CLI needs
# the cloud project identity to query preview deployments.
if [[ "${CONVEX_DEPLOYMENT:-}" == local:* ]]; then
  unset CONVEX_DEPLOYMENT
fi

# Fetch env vars from the preview backend
ENV_OUTPUT=$(bunx convex env list --preview-name "$PREVIEW_NAME" 2>&1) || {
  echo "Error: Could not fetch env vars for preview '$PREVIEW_NAME'"
  echo "$ENV_OUTPUT"
  exit 1
}

INTERNAL_API_SECRET=$(echo "$ENV_OUTPUT" | grep '^INTERNAL_API_SECRET=' | cut -d= -f2-)
if [ -z "$INTERNAL_API_SECRET" ]; then
  echo "Error: INTERNAL_API_SECRET not found on preview backend"
  exit 1
fi

# Read the Convex URL stored by the build script
CONVEX_URL=$(echo "$ENV_OUTPUT" | grep '^CONVEX_SELF_URL=' | cut -d= -f2-)
if [ -z "$CONVEX_URL" ]; then
  echo ""
  echo "CONVEX_SELF_URL not found on preview backend."
  echo "Find the URL in the Vercel build logs or Convex dashboard."
  echo ""
  echo "Enter the preview Convex URL (e.g. https://wandering-mallard-230.convex.cloud):"
  read -r CONVEX_URL
fi

if [ -z "$CONVEX_URL" ]; then
  echo "Error: CONVEX_URL is required"
  exit 1
fi

# Derive CONVEX_SITE_URL from CONVEX_URL (.convex.cloud → .convex.site)
CONVEX_SITE_URL="${CONVEX_URL%.convex.cloud}.convex.site"

echo ""
echo "Starting companion for preview: $PREVIEW_NAME"
echo "  CONVEX_URL:      $CONVEX_URL"
echo "  CONVEX_SITE_URL: $CONVEX_SITE_URL"
echo ""

CONVEX_URL="$CONVEX_URL" \
CONVEX_SITE_URL="$CONVEX_SITE_URL" \
INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  bun run src/companion.ts
