#!/usr/bin/env bash
set -euo pipefail

# Fetch and display review bot comments on a GitHub PR
# Usage:
#   bun run pr-comments                      # show unresolved comments (auto-detect PR)
#   bun run pr-comments -- 42                # show unresolved comments on PR #42
#   bun run pr-comments -- --all             # show all comments (including resolved)
#   bun run pr-comments -- --poll            # wait for review, then show new comments
#   bun run pr-comments -- --poll 42         # poll specific PR
#   bun run pr-comments -- --resolve         # resolve all review bot threads
#   bun run pr-comments -- --resolve 42      # resolve threads on specific PR

# Review bots to track (bare login — GraphQL omits [bot] suffix)
BOT_LOGINS=("greptile-apps" "coderabbitai" "chatgpt-codex-connector")

POLL=false
RESOLVE=false
SHOW_ALL=false
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
    --all)
      SHOW_ALL=true
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
OWNER="${OWNER_REPO%%/*}"
REPO="${OWNER_REPO##*/}"

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

# Build jq select filter for bot logins at a given path
build_login_filter() {
  local path="$1"
  local filter=""
  for login in "${BOT_LOGINS[@]}"; do
    [ -n "$filter" ] && filter="$filter or "
    filter="${filter}(${path} | startswith(\"$login\"))"
  done
  echo "$filter"
}

# Fetch review threads via GraphQL (supports resolved/unresolved filtering)
# Args: $1 = "unresolved" (default) or "all"
fetch_review_threads() {
  local mode="${1:-unresolved}"
  local resolved_filter=""
  if [ "$mode" = "unresolved" ]; then
    resolved_filter='| select(.isResolved == false)'
  fi

  gh api graphql -f query="
    {
      repository(owner: \"$OWNER\", name: \"$REPO\") {
        pullRequest(number: $PR_NUMBER) {
          reviewThreads(first: 100) {
            nodes {
              id
              isResolved
              path
              line
              comments(first: 1) {
                nodes {
                  databaseId
                  author { login }
                  body
                }
              }
            }
          }
        }
      }
    }
  " --jq ".data.repository.pullRequest.reviewThreads.nodes[] $resolved_filter | select($(build_login_filter ".comments.nodes[0].author.login")) | {id: .comments.nodes[0].databaseId, path: .path, line: (.line // \"\"), body: .comments.nodes[0].body, author: .comments.nodes[0].author.login, threadId: .id}"
}

format_comments() {
  local comments="$1"
  if [ -z "$comments" ]; then
    echo "No review bot comments found on PR #$PR_NUMBER"
    return
  fi

  echo "$comments" | jq -r '
    "=== Comment #\(.id) [\(.author)] ===\nFile: \(.path):\(.line)\nBody: \(.body)\n"
  '
}

resolve_threads() {
  local threads
  threads=$(fetch_review_threads "unresolved" | jq -r '.threadId')

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
  # One-shot mode: fetch and display comments
  if [ "$SHOW_ALL" = true ]; then
    COMMENTS=$(fetch_review_threads "all")
  else
    COMMENTS=$(fetch_review_threads "unresolved")
  fi
  format_comments "$COMMENTS"
  exit 0
fi

# Poll mode: record existing comment IDs, wait for all checks to pass, then show new comments
SEEN_IDS=$(fetch_review_threads "all" | jq -s '[.[].id]')
if [ -z "$SEEN_IDS" ]; then
  SEEN_IDS="[]"
fi

echo "Waiting for all PR checks to complete..."
gh pr checks "$PR_NUMBER" --watch

echo ""
echo "All checks complete. Fetching review comments..."

ALL_COMMENTS=$(fetch_review_threads "unresolved")
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
