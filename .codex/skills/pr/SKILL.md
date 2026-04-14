---
name: pr
description: Create GitHub pull request with pre-flight quality checks
---

# Create GitHub Pull Request

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

Create a GitHub pull request with pre-flight quality checks.

## Usage

/pr

## Pre-flight Checks

### 1. Verify Branch

```bash
git branch --show-current
```

Ensure not on `main` — warn and stop if so.

### 2. Check for Uncommitted Changes

```bash
git status
```

Warn if there are uncommitted changes.

### 3. Run Quality Checks

```bash
bun run lint
bunx tsc --noEmit
```

Both must pass before creating PR.

### 4. Review Changes

```bash
git diff main...HEAD
git log main..HEAD --oneline
```

## PR Creation

### Title Format

Use a conventional commit prefix followed by a concise description. Choose the prefix based on the nature of the changes:

- `feat:` — new functionality
- `fix:` — bug fix
- `refactor:` — code restructuring without behavior change
- `test:` — adding or updating tests
- `chore:` — tooling, config, dependencies
- `docs:` — documentation only

Examples:
- `feat: add session resume support`
- `fix: WebSocket reconnection on session timeout`
- `refactor: extract session manager into separate module`

### Description Guidelines

- Summarize changes made in current branch vs main
- Note any breaking changes or migration steps
- Do not include a testing plan in the description

### Create PR

```bash
gh pr create --title "<title>" --body "<description>"
```

## Post-Creation

Display the PR URL for the user to review.
