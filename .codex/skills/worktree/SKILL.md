---
name: worktree
description: Create new git worktree for parallel feature development
---

# Create New Git Worktree

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

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

Run the worktree creation script:

```bash
bun run worktree:create <feature-name>
```

This handles everything: worktree creation, branch setup, dependency installation, port assignment, and local Convex initialization.

### 3. Verify Setup

```bash
cd ~/.holophyte-dev/<feature-name> && ls -la .env* .dev-ports
```

## After Creation

- Run `bun run dev:local` in the new worktree (uses isolated local Convex)
- The main directory remains on its current branch
- Worktrees are stored in `~/.holophyte-dev/`
