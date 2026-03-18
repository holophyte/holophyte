#!/usr/bin/env bash
set -euo pipefail

# Fetch and display review bot comments on a GitHub PR (Greptile + CodeRabbit)
# Usage:
#   bun run pr-comments                      # show all comments (auto-detect PR)
#   bun run pr-comments -- 42                # show comments on PR #42
#   bun run pr-comments -- --poll            # wait for review, then show new comments
#   bun run pr-comments -- --poll 42         # poll specific PR
#   bun run pr-comments -- --resolve         # resolve all review bot threads
#   bun run pr-comments -- --resolve 42      # resolve threads on specific PR

# Review bots to track
BOT_LOGINS=("greptile-apps[bot]" "coderabbitai[bot]")

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

# Build jq filter for bot logins
bot_filter() {
  local filter=""
  for login in "${BOT_LOGINS[@]}"; do
    if [ -n "$filter" ]; then
      filter="$filter or "
    fi
    filter="$filter.user.login == \"$login\""
  done
  echo "$filter"
}

fetch_review_comments() {
  gh api "repos/$OWNER_REPO/pulls/$PR_NUMBER/comments" \
    --jq ".[] | select($(bot_filter)) | {id: .id, path: .path, line: (.line // .original_line // \"\"), body: .body, author: .user.login}"
}

format_comments() {
  local comments="$1"
  if [ -z "$comments" ]; then
    echo "No review bot comments found on PR #$PR_NUMBER"
    return
  fi

  echo "$comments" | jq -r '
    "=== Comment #\(.id) ===\nFile: \(.path):\(.line)\nBody: \(.body)\n"
  '
}

resolve_threads() {
  local owner="${OWNER_REPO%%/*}"
  local repo="${OWNER_REPO##*/}"

  # Build GraphQL jq filter for bot logins
  local jq_bot_filter=""
  for login in "${BOT_LOGINS[@]}"; do
    if [ -n "$jq_bot_filter" ]; then
      jq_bot_filter="$jq_bot_filter or "
    fi
    jq_bot_filter="$jq_bot_filter.comments.nodes[0].author.login == \"$login\""
  done

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
  " --jq ".data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | select($jq_bot_filter) | .id")

  if [ -z "$threads" ]; then
    echo "No unresolved review bot threads on PR #$PR_NUMBER"
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

  echo "Resolved $count review bot thread(s) on PR #$PR_NUMBER"
}

if [ "$RESOLVE" = true ]; then
  resolve_threads
  exit 0
fi

if [ "$POLL" = false ]; then
  # One-shot mode: fetch and display all comments
  COMMENTS=$(fetch_review_comments)
  format_comments "$COMMENTS"
  exit 0
fi

# Poll mode: record existing comment IDs, wait for all checks to pass, then show new comments
SEEN_IDS=$(fetch_review_comments | jq -s '[.[].id]')
if [ -z "$SEEN_IDS" ]; then
  SEEN_IDS="[]"
fi

echo "Waiting for all PR checks to complete..."
gh pr checks "$PR_NUMBER" --watch

echo ""
echo "All checks complete. Fetching review comments..."

ALL_COMMENTS=$(fetch_review_comments)
if [ -z "$ALL_COMMENTS" ]; then
  echo "No review bot comments on PR #$PR_NUMBER"
  exit 0
fi

# Filter to only new comments (IDs not in SEEN_IDS)
NEW_COMMENTS=$(echo "$ALL_COMMENTS" | jq -c --argjson seen "$SEEN_IDS" '
  select(.id as $id | $seen | index($id) | not)
')

if [ -n "$NEW_COMMENTS" ]; then
  echo ""
  echo "New review comments:"
  echo ""
  format_comments "$NEW_COMMENTS"
else
  echo "No new review bot comments on PR #$PR_NUMBER"
fi
