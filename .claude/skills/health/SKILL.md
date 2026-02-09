---
name: health
description: Run full-stack health checks on the project
user-invocable: true
---

# Project Health Check

Run a comprehensive health check across the full stack and report any issues.

## Usage

/health

## Checks

Run all checks and collect results. Do NOT stop on first failure — run everything and present a full report.

### 1. Lint

```bash
bun run lint
```

### 2. Type Check

```bash
bunx tsc --noEmit
```

### 3. Unit Tests

```bash
bun run test
```

### 4. Git Status

```bash
git status
```

Report: uncommitted changes, untracked files, divergence from remote.

### 5. Dependencies

```bash
bun install --dry-run
```

Check if `node_modules` is in sync with `bun.lock`.

### 6. Convex Status

Check if Convex is configured:
```bash
cat .env.local
```

Verify `CONVEX_DEPLOYMENT` is set.

## Report Format

Present results as a checklist:

```
## Health Report

- [x] Lint — passed
- [x] Typecheck — passed
- [ ] Tests — 2 failing (describe briefly)
- [x] Git — clean, up to date with remote
- [x] Dependencies — in sync
- [x] Convex — configured (deployment: dev:xxx)
```

For any failing check, include a brief summary of what's wrong (first few lines of error output, not the full log).

## Notes

- Run all checks in parallel where possible for speed
- This is read-only — never fix issues automatically
- If the user wants to fix issues, suggest the appropriate command (e.g., `bun run lint:fix`, `/test`)
