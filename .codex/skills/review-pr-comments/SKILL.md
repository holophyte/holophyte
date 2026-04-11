---
name: review-pr-comments
description: Review and address comments on a GitHub pull request
---

# Review PR Comments

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

Review all unresolved comments on a GitHub pull request, categorize them, and optionally address each one.

## Usage

/review-pr-comments [PR-NUMBER]

- If no PR number provided, auto-detect from current branch
- Explicit PR number overrides auto-detection

## Process

### 1. Identify PR

If `$ARGUMENTS` is empty, auto-detect:
```bash
gh pr list --head $(git branch --show-current) --json number,title --jq '.[0]'
```

If `$ARGUMENTS` contains a PR number, use that directly.

### 2. Fetch Comments

Fetch review bot comments using the script:
```bash
bun run pr-comments -- <PR_NUMBER>
```

Also fetch general PR conversation comments:
```bash
gh api repos/{owner}/{repo}/issues/<PR>/comments
```

### 3. Filter and Categorize

**Filter out resolved comments** - only process unresolved/pending comments.

Categorize remaining comments into:

**Required Changes**
- Explicit requests for code changes
- Bug fixes or correctness issues
- Security concerns

**Suggestions**
- Optional improvements
- Style preferences
- Alternative approaches

**Questions**
- Clarification requests
- Design decisions to discuss

### 4. Present Summary

Display organized summary with:
- Comment author
- File/line reference (if applicable)
- Comment content
- Category

### 5. Address Comments

After presenting the summary, ask: "Would you like me to address any of these comments?"

For each comment to address:
1. Read the relevant file
2. Understand the requested change
3. Implement the change
4. Show the diff
5. Ask for confirmation before moving to next comment

**For comments that won't result in code changes** (intentional design decisions, already handled differently, disagree with the suggestion, etc.), reply to the review thread on GitHub explaining why:
```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments/<COMMENT_ID>/replies -f body="<explanation>"
```
This keeps the reviewer thread from being left hanging and documents the reasoning.

### 6. Resolve Conversations

After all comments have been addressed or replied to, resolve the review bot threads on GitHub **before pushing the fix commit** — threads must still be unresolved for the script to find them:
```bash
bun run pr-comments -- --resolve <PR_NUMBER>
```

This calls the GitHub GraphQL `resolveReviewThread` mutation on all unresolved threads from review bots.
