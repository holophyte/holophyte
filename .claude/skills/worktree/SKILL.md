---
name: worktree
description: Create new git worktree for parallel feature development
user-invocable: true
---

# Create New Git Worktree

Set up a new git worktree for working on a feature in parallel.

## Usage

/worktree [feature-name]

- If no argument provided, prompt for feature name
- Automatically creates branch `feat/<feature-name>`

## When to use

- Features or refactors that touch multiple files
- Work you want to run in parallel with other sessions
- NOT needed for quick fixes, small changes, or single-file edits

## Process

### 1. Determine Feature Name

Use `$ARGUMENTS` if provided, otherwise ask the user.

### 2. Create Worktree

```bash
git worktree add ../holophyte-<feature-name> -b feat/<feature-name>
```

### 3. Copy Essential Files

```bash
cp ../holophyte/.env ../holophyte-<feature-name>/ 2>/dev/null || true
cp ../holophyte/.env.local ../holophyte-<feature-name>/ 2>/dev/null || true
```

Note: CLAUDE.md, .claude/, and other tracked files come with the worktree automatically.

### 4. Install Dependencies

```bash
cd ../holophyte-<feature-name> && bun install
```

### 5. Verify Setup

```bash
cd ../holophyte-<feature-name> && ls -la .env* CLAUDE.md
```

## After Creation

- Run `bun run dev` and `bun run convex:dev` in the new worktree
- The main holophyte directory remains on its current branch
