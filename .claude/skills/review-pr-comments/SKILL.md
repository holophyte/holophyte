---
name: review-pr-comments
description: Review and address comments on a GitHub pull request
user-invocable: true
---

# Review PR Comments

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

Fetch Greptile review comments using the script:
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

### 6. Resolve Conversations

After all comments have been addressed (code changes made and confirmed), resolve the Greptile review threads on GitHub:
```bash
bun run pr-comments -- --resolve <PR_NUMBER>
```

This clicks "Resolve conversation" on all Greptile threads via the GitHub GraphQL API.
