---
name: branch-status
description: Overview of all branches, PRs, and worktrees
---

# Branch Status Overview

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

Show a comprehensive overview of all branches, their PR status, and active worktrees.

## Usage

/branch-status

## Process

### 1. Fetch Latest

```bash
git fetch --all --prune
```

### 2. List All Local Branches

```bash
git branch -vv
git for-each-ref --sort=-committerdate --format='%(refname:short) %(committerdate:iso8601) %(committerdate:relative)' refs/heads
```

Capture: branch name, last commit, tracking status (ahead/behind/gone), last commit date.

### 3. List Worktrees

```bash
git worktree list
```

### 4. List Open PRs

```bash
gh pr list --json number,title,headRefName,state,url,isDraft,reviewDecision --limit 50
```

### 5. Check Merge Status

For each local branch (excluding main), check if merged:
```bash
git branch --merged origin/main
```

### 6. Present Report

Organize branches into categories:

```markdown
## Branch Status

### Active Worktrees
| Directory | Branch | Status |
|-----------|--------|--------|
| ~/.holophyte-dev/feature-x | feat/feature-x | 2 ahead of main |

### Branches with Open PRs
| Branch | PR | Status | Review |
|--------|-----|--------|--------|
| feat/feature-y | #12 — Add feature Y | Open | Approved |
| feat/feature-z | #13 — Fix bug Z | Draft | Pending |

### Merged (safe to clean up)
- `feat/old-feature` — merged into main, remote deleted

### Stale (no PR, not merged)
- `feat/abandoned` — last commit 3 weeks ago, 5 ahead of main

### Current Branch
`main` — clean, up to date with origin/main
```

## Notes

- Always run `git fetch --all --prune` first to get accurate remote status
- Flag branches where the remote has been deleted (`gone` in tracking status)
- For branches with PRs, show the review decision (approved, changes requested, pending)
- Sort stale branches by last commit date
- This is read-only — never delete branches or worktrees automatically
- If the user wants to clean up, suggest `/worktree-cleanup` for worktrees (destructive — removes worktrees and deletes branches, requires confirmation)
