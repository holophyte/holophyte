---
name: autopilot
description: Implement a feature and iterate on Greptile review comments autonomously
user-invocable: true
---

# Autopilot

Implement a feature, push a PR, and autonomously iterate on Greptile code review
comments until resolved.

## Usage

/autopilot <description of what to implement>

## Process

### 1. Set Up Worktree (if needed)

If not already on a feature branch, create a worktree to avoid disrupting current work:

```bash
BRANCH=$(git branch --show-current)
```

- If on `main`: derive a short feature name from `$ARGUMENTS` (e.g., "add drag reordering" becomes `drag-reordering`), then run `bun run worktree:create <feature-name>` and work from the new worktree directory
- If already on a `feat/` branch: continue in the current directory

### 2. Implement the Feature

Implement the feature described in `$ARGUMENTS`.

- Follow all patterns and conventions in CLAUDE.md
- Run quality checks when implementation is complete:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
```

- If tests fail, use the `test-fixer` subagent to analyze and fix failures
- Fix lint/type errors directly

### 3. Self-Review with Subagents

Before committing, run reviewers in parallel:

> Use the code-reviewer subagent to review the current changes
> Use the security-reviewer subagent to audit the current changes

- Fix any **critical** issues from either reviewer
- Evaluate **warnings** and fix if valid
- **Suggestions** are optional — skip unless clearly beneficial
- Run quality checks again if changes were made

### 4. Commit and Push

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push -u origin $(git branch --show-current)
```

### 5. Create or Update PR

Check if a PR already exists for this branch:

```bash
gh pr list --head $(git branch --show-current) --json number --jq '.[0].number'
```

- If no PR exists, create one with `gh pr create` — use a conventional prefix in the title (e.g., `feat: add drag reordering to kanban columns`)
- If PR exists, it's already updated by the push

### 6. Poll for Greptile Review

Wait for Greptile to post review comments using the polling script:

```bash
bun run pr-comments -- --poll <PR_NUMBER>
```

This records existing comment IDs, polls every 30s for up to 5 minutes, and outputs only new comments.

- If timeout with no new comments, exit successfully — Greptile found nothing new

### 7. Triage Comments

Read the output from the polling script. Categorize each new comment:

**Actionable** — fix the code:
- Bug or correctness issues
- Security concerns
- Clear code quality improvements

**Dismissable** — reply explaining why no change is needed:
- Stylistic preferences that conflict with project conventions in CLAUDE.md
- False positives or misunderstandings of intent
- Suggestions that would over-engineer the solution

### 8. Address Comments

For each actionable comment:
1. Read the file at the referenced line
2. Fix the issue
3. Reply to the comment with a brief explanation of the fix

For each dismissable comment:
1. Reply to the comment explaining why no change is needed

Reply to comments using:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments/<COMMENT_ID>/replies \
  -f body="<reply>"
```

### 9. Push and Loop

After addressing all comments:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
```

- If tests fail, use the `test-fixer` subagent to fix them

```bash
git add <changed files>
git commit -m "fix: address greptile review feedback"
git push
```

Return to **Step 6** for the next round.

### 10. Exit Conditions

Stop the loop when any of these are true:

- **No new comments** — Greptile found nothing new after the latest push (success)
- **Max 3 iterations** — report remaining unresolved comments to the user
- **Quality checks fail after 2 retries** — stop and report the errors

### 11. Summary

When exiting, display:
- Total iterations completed
- Comments addressed (with links) vs dismissed (with reasons)
- Any unresolved comments remaining
- Final PR URL
