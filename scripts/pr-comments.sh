#!/usr/bin/env bash
set -euo pipefail

# Fetch and display Greptile review comments on a GitHub PR
# Usage:
#   bun run pr-comments                      # show all comments (auto-detect PR)
#   bun run pr-comments -- 42                # show comments on PR #42
#   bun run pr-comments -- --poll            # poll for new comments (checks at 5m, 7.5m, 10m)
#   bun run pr-comments -- --poll 42         # poll specific PR
#   bun run pr-comments -- --resolve         # resolve all Greptile threads
#   bun run pr-comments -- --resolve 42      # resolve threads on specific PR

POLL=false
RESOLVE=false
PR_NUMBER=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --poll)
      POLL=true
      shift
      ;;
    --resolve)
      RESOLVE=true
      shift
      ;;
    *)
      PR_NUMBER="$1"
      shift
      ;;
  esac
done

# Validate PR number is numeric if provided
if [ -n "$PR_NUMBER" ] && ! [[ "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "Error: Invalid PR number '$PR_NUMBER' (must be numeric)"
  exit 1
fi

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
  if [ -z "$comments" ]; then
    echo "No Greptile comments found on PR #$PR_NUMBER"
    return
  fi

  echo "$comments" | jq -r '
    "=== Comment #\(.id) ===\nFile: \(.path):\(.line)\nBody: \(.body)\n"
  '
}

resolve_threads() {
  # Fetch unresolved Greptile review thread IDs via GraphQL
  local owner="${OWNER_REPO%%/*}"
  local repo="${OWNER_REPO##*/}"

  local threads
  threads=$(gh api graphql -f query="
    {
      repository(owner: \"$owner\", name: \"$repo\") {
        pullRequest(number: $PR_NUMBER) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              comments(first: 1) {
                nodes { author { login } }
              }
            }
          }
        }
      }
    }
  " --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | select(.comments.nodes[0].author.login == "greptile-apps[bot]") | .id')

  if [ -z "$threads" ]; then
    echo "No unresolved Greptile threads on PR #$PR_NUMBER"
    return
  fi

  local count=0
  while IFS= read -r thread_id; do
    gh api graphql -f query="
      mutation {
        resolveReviewThread(input: { threadId: \"$thread_id\" }) {
          thread { isResolved }
        }
      }
    " --silent
    count=$((count + 1))
  done <<< "$threads"

  echo "Resolved $count Greptile thread(s) on PR #$PR_NUMBER"
}

if [ "$RESOLVE" = true ]; then
  resolve_threads
  exit 0
fi

if [ "$POLL" = false ]; then
  # One-shot mode: fetch and display all comments
  COMMENTS=$(fetch_greptile_comments)
  format_comments "$COMMENTS"
  exit 0
fi

# Poll mode: record existing comment IDs, then check at fixed intervals
echo "Recording existing Greptile comments..."
SEEN_IDS=$(gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]") | .id]')

# Greptile typically takes 5-10 minutes to review — check at 5m, 7.5m, 10m
POLL_DELAYS=(300 150 150)  # seconds to sleep before each check (5m, +2.5m, +2.5m)
POLL_LABELS=("5m" "7.5m" "10m")

echo "Waiting for Greptile review (checks at 5m, 7.5m, 10m)..."

for i in "${!POLL_DELAYS[@]}"; do
  sleep "${POLL_DELAYS[$i]}"
  echo "  Checking at ${POLL_LABELS[$i]}..."

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

echo "No new Greptile comments after 10 minutes"
exit 0
