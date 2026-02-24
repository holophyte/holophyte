---
sidebar_position: 3
title: Local Development & Worktrees
---

# Local Development & Worktrees

Holophyte uses **local Convex backends** for development. Each workspace (main repo + worktrees) gets its own isolated Convex instance with dedicated ports, preventing data collisions between parallel development environments.

## How It Works

Every workspace has a `.dev-ports` file (gitignored) that defines its port assignments and Convex project identity:

```
DEV_PORT=8080
CONVEX_CLOUD_PORT=3210
CONVEX_SITE_PORT=3211
CONVEX_TEAM=ko-vial
CONVEX_PROJECT=holophyte
```

When you run `bun run dev:local`, the scripts read `.dev-ports` and start:
1. A **local Convex backend** on `CONVEX_CLOUD_PORT` / `CONVEX_SITE_PORT`
2. The **Bun app server** on `DEV_PORT`

The Convex CLI writes the deployment identity and URLs to `.env.local`, which the app server reads at startup.

## Worktrees

Worktrees let you work on multiple features in parallel, each with its own isolated Convex database. They live in `~/.holophyte-dev/<feature-name>` and run on branch `feat/<feature-name>`.

### Creating a Worktree

```bash
bun run worktree:create <feature-name>
```

This handles:
1. Git worktree creation on a new `feat/<feature-name>` branch
2. Copying `.env` and non-Convex vars from `.env.local` (API keys, secrets)
3. `bun install`
4. Port allocation (scanning all existing `.dev-ports` files to avoid collisions)
5. Local Convex provisioning with a unique deployment name

### Running a Worktree

```bash
cd ~/.holophyte-dev/<feature-name>
bun run dev:local
```

### Port Allocation

Ports are assigned in **slots** of 2, starting after the main repo (slot 0 = 8080):

| Slot | DEV_PORT | E2E_PORT | CONVEX_CLOUD | CONVEX_SITE |
|------|----------|----------|--------------|-------------|
| 0 (main) | 8080 | 8081 | 3210 | 3211 |
| 1 | 8082 | 8083 | 3212 | 3213 |
| 2 | 8084 | 8085 | 3214 | 3215 |
| 3 | 8086 | 8087 | 3216 | 3217 |

The allocation algorithm scans all `~/.holophyte-dev/*/.dev-ports` files and the main repo's `.dev-ports` to find the first unallocated slot. It also checks if ports are currently in use as a fallback.

### Worktree Cleanup

To remove a worktree:

```bash
# From the main repo
git worktree remove ~/.holophyte-dev/<feature-name>
git branch -d feat/<feature-name>  # if branch was merged
```

The local Convex data persists in `~/.local/share/convex/` under the deployment name. This is harmless — it will be reused if you recreate a worktree with the same deployment, or ignored otherwise.

## Convex Deployment Isolation

Each workspace gets a **unique Convex deployment name** (e.g., `local-ko_vial-holophyte`, `local-ko_vial-holophyte-1`, `local-ko_vial-holophyte-2`). This is critical — the deployment name determines the data directory on disk.

The deployment identity is stored in `.env.local`:

```
CONVEX_DEPLOYMENT=local:local-ko_vial-holophyte-1
CONVEX_URL=http://127.0.0.1:3212
CONVEX_SITE_URL=http://127.0.0.1:3213
```

### How Fresh Deployments Are Provisioned

When `worktree-create.sh` copies `.env.local` from main, it **strips** `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL`. This forces `convex dev --configure existing` to provision a new deployment with a unique name rather than reusing the main repo's.

### Stale Deployment Detection

`convex-local.sh` validates that `CONVEX_URL` in `.env.local` matches the expected port from `.dev-ports`. If there's a mismatch (e.g., `.env.local` points to port 3210 but `.dev-ports` says 3218), it strips the stale vars and reconfigures automatically.

## E2E Tests in Worktrees

Playwright E2E tests (`bun run test:e2e`) work in worktrees with some considerations:

- The E2E server runs on `DEV_PORT + 1` (read from `.dev-ports`)
- `playwright.config.ts` passes `CONVEX_URL` derived from `.dev-ports` to the E2E web server, ensuring it connects to the correct local Convex instance
- You must have `bun run convex:local` running in the worktree before running E2E tests

## Gotchas

### `.env.local` with stale Convex vars causes silent cross-contamination

If `.env.local` contains `CONVEX_DEPLOYMENT` or `CONVEX_URL` from another workspace, the app server silently connects to the wrong Convex database. Symptoms: data appearing/disappearing unexpectedly, or mutations in one workspace affecting another.

**Fix:** `convex-local.sh` now auto-detects port mismatches and reconfigures. If you suspect contamination, delete `CONVEX_DEPLOYMENT`, `CONVEX_URL`, and `CONVEX_SITE_URL` from `.env.local` and restart `bun run dev:local`.

### `convex dev --configure existing` reuses deployment names when `CONVEX_DEPLOYMENT` is present

Convex treats an existing `CONVEX_DEPLOYMENT=local:*` in `.env.local` as "already configured" and reinitializes with the same name. This is correct behavior for restarting a workspace, but causes collisions when the value was copied from another workspace.

**Fix:** Always strip Convex-managed vars before provisioning. The worktree creation script does this automatically.

### `convex dev --local` silently connects to cloud without `CONVEX_TEAM`/`CONVEX_PROJECT`

If `.env.local` has a `dev:` deployment (cloud) and `.dev-ports` is missing `CONVEX_TEAM`/`CONVEX_PROJECT`, `convex dev --local` silently connects to cloud instead of starting a local backend. Always include both in `.dev-ports`.

### `@convex-dev/auth` requires a running backend

The Convex Auth setup command (`bunx @convex-dev/auth`) needs the backend running to set environment variables. It cannot run after `convex dev --once` exits. Auth keys are configured automatically on first `bun run dev:local` when the backend is running.

### Port allocation doesn't survive worktree deletion and recreation

If you delete a worktree and its `.dev-ports` file, then create a new worktree, the new one may reuse the deleted worktree's port slot. This is usually fine, but can cause issues if the old worktree's Convex backend is still running.

**Fix:** Stop all running dev servers before creating new worktrees, or manually check for port conflicts with `lsof -iTCP -sTCP:LISTEN`.

### Playwright browser processes can linger after failed setup

If `e2e/global-setup.ts` fails mid-way (e.g., timeout waiting for hydration), the Chromium process may not be cleaned up. Symptoms: subsequent test runs fail to launch a browser, or orphaned Chrome processes consume memory.

**Fix:** The setup now uses `try/finally` to ensure `browser.close()` always runs. If you still see orphaned processes:

```bash
pkill -f "chromium.*--headless"
```

### Playwright E2E server may use wrong Convex URL in worktrees

The E2E web server spawned by Playwright reads `CONVEX_URL` from `.env.local`. If `.env.local` has stale URLs from another worktree, the test server connects to the wrong database.

**Fix:** `playwright.config.ts` now passes `CONVEX_URL` derived from `.dev-ports` via the web server env config, which takes precedence over `.env.local` (Bun doesn't override env vars already set in the process environment).

### `bun run --watch` swallows subprocess stderr

When using `bun run --watch`, subprocess stderr is invisible. This hides SDK errors, Convex connection failures, and other critical debugging output.

**Fix:** Run `bun src/server.ts` directly (without `--watch`) when debugging issues.
