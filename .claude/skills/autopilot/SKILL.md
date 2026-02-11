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
REPO=$(basename "$(git rev-parse --show-toplevel)")
BRANCH=$(git branch --show-current)
```

- If on `main`: create a worktree with `git worktree add ../$REPO-<feature-name> -b feat/<feature-name>`, copy `.env`/`.env.local`, run `bun install`, then work from that directory
- If already on a `feat/` branch: continue in the current directory
- Derive a short feature name from `$ARGUMENTS` (e.g., "add drag reordering" becomes `drag-reordering`)

### 2. Implement the Feature

Implement the feature described in `$ARGUMENTS`.

- Follow all patterns and conventions in CLAUDE.md
- Run quality checks when implementation is complete:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
```

- Fix any issues before proceeding

### 3. Self-Review with Subagent

Before committing, run the `code-reviewer` subagent to review changes:

> Use the code-reviewer subagent to review the current changes

- Fix any **critical** issues found by the reviewer
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

Wait for Greptile to post review comments. Poll every 30 seconds, up to 5 minutes.

Track the current comment count before pushing:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]")] | length'
```

After pushing, poll until the count increases (new review posted) or timeout.

- If timeout with no new comments, exit successfully — Greptile found nothing new

### 7. Read and Triage Comments

Fetch all Greptile comments from the latest review round (new comments since last check):

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments \
  --jq '[.[] | select(.user.login == "greptile-apps[bot]")]'
```

Categorize each comment:

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
