#!/usr/bin/env bash
set -euo pipefail

# Fetch and display Greptile review comments on a GitHub PR
# Usage:
#   bun run pr-comments                  # show all comments (auto-detect PR)
#   bun run pr-comments -- 42            # show comments on PR #42
#   bun run pr-comments -- --poll        # poll for new comments
#   bun run pr-comments -- --poll 42     # poll specific PR

POLL=false
PR_NUMBER=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --poll)
      POLL=true
      shift
      ;;
    *)
      PR_NUMBER="$1"
      shift
      ;;
  esac
done

# Detect owner/repo
OWNER_REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')

# Detect PR number if not provided
if [ -z "$PR_NUMBER" ]; then
  BRANCH=$(git branch --show-current)
  PR_NUMBER=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number')
  if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
    echo "Error: No PR found for branch '$BRANCH'"
    echo "Create a PR first or specify a PR number: bun run pr-comments -- <number>"
    exit 1
  fi
  echo "Detected PR #$PR_NUMBER for branch $BRANCH"
fi

fetch_greptile_comments() {
  gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
    --jq '.[] | select(.user.login == "greptile-apps[bot]") | {id: .id, path: .path, line: (.line // .original_line // ""), body: .body}'
}

format_comments() {
  local comments="$1"
  if [ -z "$comments" ] || [ "$comments" = "" ]; then
    echo "No Greptile comments found on PR #$PR_NUMBER"
    return
  fi

  echo "$comments" | jq -r '
    "=== Comment #\(.id) ===\nFile: \(.path):\(.line)\nBody: \(.body)\n"
  '
}

if [ "$POLL" = false ]; then
  # One-shot mode: fetch and display all comments
  COMMENTS=$(fetch_greptile_comments)
  format_comments "$COMMENTS"
  exit 0
fi

# Poll mode: record existing comment IDs, poll for new ones
echo "Recording existing Greptile comments..."
SEEN_IDS=$(gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]") | .id]')

echo "Polling for new Greptile comments (every 30s, timeout 5min)..."

ELAPSED=0
TIMEOUT=300

while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  sleep 30
  ELAPSED=$((ELAPSED + 30))
  echo "  Checking... (${ELAPSED}s / ${TIMEOUT}s)"

  ALL_COMMENTS=$(fetch_greptile_comments)
  if [ -z "$ALL_COMMENTS" ]; then
    continue
  fi

  # Filter to only new comments (IDs not in SEEN_IDS)
  NEW_COMMENTS=$(echo "$ALL_COMMENTS" | jq -c --argjson seen "$SEEN_IDS" '
    select(.id as $id | $seen | index($id) | not)
  ')

  if [ -n "$NEW_COMMENTS" ]; then
    echo ""
    echo "New Greptile comments found:"
    echo ""
    format_comments "$NEW_COMMENTS"
    exit 0
  fi
done

echo "Timeout: no new Greptile comments after ${TIMEOUT}s"
exit 0
