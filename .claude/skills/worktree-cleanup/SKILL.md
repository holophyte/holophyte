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

1. Check if branch has remote tracking: `git branch -vv`
2. Check if merged into main: `git branch -r --merged main`
3. Check for uncommitted changes in worktree
4. Check for unpushed local commits

### 3. Display Merge Status

- Safe to delete: Remote branch exists and has been merged into main
- Caution: Remote branch exists but has NOT been merged into main
- Caution: No remote branch exists (work may not be pushed)

### 4. Request Confirmation

Always ask for explicit confirmation before proceeding, especially if warnings are present.

### 5. Remove Worktree and Branch

```bash
git worktree remove ../holophyte-<feature-name>
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
