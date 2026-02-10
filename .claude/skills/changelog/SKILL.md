---
name: changelog
description: Generate a changelog from recent commits
user-invocable: true
---

# Generate Changelog

Generate a human-readable changelog from git commits, grouped by conventional commit type.

## Usage

/changelog [range]

- No argument: commits since last tag, or last 20 commits if no tags exist
- With argument: use as git log range (e.g., `v1.0..HEAD`, `main..feat/branch`)

## Process

### 1. Determine Range

If `$ARGUMENTS` is provided, use it as the range.

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
- Add terminal resize support (a1b2c3d)
- Add repo deletion with cascade (d4e5f6a)

### Bug Fixes
- Fix WebSocket reconnection on timeout (b7c8d9e)

### Refactoring
- Refactor PTY manager for multi-session support (f0a1b2c)

### Chores
- Update dependencies (c3d4e5f)
```

## Notes

- Strip the prefix from commit messages in the output (e.g., `feat: Add X` becomes `Add X`)
- Include the short commit hash for reference
- Skip empty sections — only show categories that have commits
- If all commits lack prefixes, just list them without categories
