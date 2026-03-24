---
name: worktree-cleanup
description: Clean up git worktree with safety checks
user-invocable: true
---

# Clean Up Git Worktree

Remove a git worktree along with its associated branch and directory.

**Warning**: This is a destructive operation. Always verify before deleting.

## Usage

/worktree-cleanup [worktree-name]

- If no argument provided, list worktrees and ask user to select
- Requires explicit confirmation before deletion

## Process

### 1. List Available Worktrees

```bash
git worktree list
```

Present worktrees to user (excluding main directory).

### 2. Safety Checks

Before deletion, verify:

1. Check for uncommitted changes in worktree
2. Check PR merge status via GitHub CLI (handles squash merges correctly):
   ```bash
   gh pr list --head "feat/<name>" --state merged --json number,title,mergedAt
   ```
   - If a merged PR exists → **Safe to delete**
   - If an open PR exists (`--state open`) → **Caution** — PR still open
   - If no PR found → Check if branch has a remote (`git branch -vv`) and warn accordingly

**Why `gh pr list` instead of `git branch --merged`**: This repo uses squash merges, which create a new commit on main. Git doesn't recognize the original branch as merged since the commit SHAs differ. Checking GitHub PR status is the reliable way to detect squash merges.

### 3. Display Merge Status

- **Safe to delete**: PR was merged (squash-merged into main)
- **Caution**: PR is still open — work may not be reviewed/merged yet
- **Caution**: No PR found and no remote branch — work may not be pushed

### 4. Request Confirmation

Always ask for explicit confirmation before proceeding, especially if warnings are present.

### 5. Remove Worktree and Branch

```bash
git worktree remove ~/.holophyte-dev/<feature-name>
git branch -D feat/<feature-name>
```

### 6. Verify Removal

```bash
git worktree list
git branch -a
```

## Safety Rules

- **Never** delete the main worktree
- **Always** warn if PR may not be complete (unmerged remote branch)
- **Always** warn if there are uncommitted changes
- **Always** require explicit confirmation
