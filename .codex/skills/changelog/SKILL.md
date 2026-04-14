---
name: changelog
description: Generate a changelog or update CHANGELOG.md with new commits
---

# Generate / Update Changelog

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

Generate a human-readable changelog from git commits, grouped by date and conventional commit type. Can either display a summary or update `CHANGELOG.md` with new entries.

## Usage

/changelog [range | update]

- No argument: display commits since last tag, or last 20 commits if no tags exist
- With range argument: use as git log range (e.g., `v1.0..HEAD`, `main..feat/branch`)
- `update`: update `CHANGELOG.md` with commits since its latest entry

## Mode: Update CHANGELOG.md

When `$ARGUMENTS` is `update` (or contains "update"):

### 1. Find the Latest Entry Date

Read `CHANGELOG.md` and find the most recent `## YYYY-MM-DD` heading. This is the cutoff date.

### 2. Fetch New Commits

```bash
git log --pretty=format:"%h %ad %s" --date=short --no-merges --after=<day-before-cutoff-date>
```

If no `CHANGELOG.md` exists or it has no date entries, fetch all commits:
```bash
git log --pretty=format:"%h %ad %s" --date=short --no-merges
```

### 3. Group by Date, Then by Type

Group commits first by date (newest first), then within each date by conventional commit prefix:

- **Added** (`feat:`)
- **Fixed** (`fix:`)
- **Changed** (commits without a recognized prefix that describe changes)
- **Refactored** (`refactor:`)
- **Tests** (`test:`)
- **Chores** (`chore:`)
- **Docs** (`docs:`)
- **Style** (`style:`)

### 4. Insert into CHANGELOG.md

- If `CHANGELOG.md` doesn't exist, create it with the header:
  ```markdown
  # Changelog

  All notable changes to this project will be documented in this file.
  Grouped by date, following [Keep a Changelog](https://keepachangelog.com/) categories.
  ```
- Insert new date sections **after the header** and **before existing entries**
- If the latest date in new commits matches the latest date already in the file, **merge** the new entries into that existing date section (append to existing categories or add new categories)
- Skip empty categories — only show categories that have commits
- Do NOT duplicate entries that already exist in the file (match by commit hash or message)

### 5. Show Summary

After updating, display a brief summary:
```text
Updated CHANGELOG.md: added X entries across Y dates
```

## Mode: Display Only (default)

When no argument or a range argument is provided:

### 1. Determine Range

If `$ARGUMENTS` is provided (and not "update"), use it as the range.

Otherwise, find the latest tag:
```bash
git describe --tags --abbrev=0 2>/dev/null
```

- If a tag exists, use `<tag>..HEAD`
- If no tags, use `--max-count 20` (no range, safe for repos with fewer than 20 commits)

### 2. Fetch Commits

If a range was determined:
```bash
git log <range> --pretty=format:"%h %s" --no-merges
```

If no tags and no argument (fallback):
```bash
git log --max-count 20 --pretty=format:"%h %s" --no-merges
```

Exclude merge commits to keep the changelog clean.

### 3. Group by Type

Parse conventional commit prefixes and group:

- **Features** (`feat:`)
- **Bug Fixes** (`fix:`)
- **Refactoring** (`refactor:`)
- **Tests** (`test:`)
- **Chores** (`chore:`)
- **Documentation** (`docs:`)
- **Other** (commits without a recognized prefix)

### 4. Format Output

```markdown
## Changelog

**Range**: `v1.0..HEAD` (12 commits)

### Features
- Add session resume support (a1b2c3d)
- Add repo deletion with cascade (d4e5f6a)

### Bug Fixes
- Fix WebSocket reconnection on timeout (b7c8d9e)

### Refactoring
- Refactor session manager for multi-session support (f0a1b2c)

### Chores
- Update dependencies (c3d4e5f)
```

## Notes

- Strip the prefix from commit messages in the output (e.g., `feat: Add X` becomes `Add X`)
- Include the short commit hash for reference in display mode; omit hashes in `CHANGELOG.md` (use PR numbers like `(#52)` when present)
- Skip empty sections — only show categories that have commits
- If all commits lack prefixes, just list them under **Changed**
- The update mode is idempotent — running it twice with no new commits makes no changes
