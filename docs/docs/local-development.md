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

## Troubleshooting

### `convex dev --local` silently connects to cloud

If `.dev-ports` is missing `CONVEX_TEAM` or `CONVEX_PROJECT`, and `.env.local` has a `dev:` deployment (cloud), `convex dev --local` silently connects to cloud instead of starting a local backend. Always include both in `.dev-ports`.

### Orphaned Chromium processes after E2E tests

If a test run crashes or is killed mid-way, Chromium processes may linger. Symptoms: subsequent test runs fail to launch a browser, or memory usage spikes.

```bash
pkill -f "chromium.*--headless"
```

### Port conflicts after deleting a worktree

If you delete a worktree but its dev server is still running, the ports stay occupied. The next `worktree:create` will skip those ports (it checks `lsof`), but if you kill the process after creation, you may end up with two worktrees on the same slot.

```bash
# Check what's listening
lsof -iTCP -sTCP:LISTEN | grep -E '(8080|3210)'
```

### `bun run --watch` swallows subprocess stderr

`bun run --watch` hides subprocess stderr output. This makes SDK errors, Convex connection failures, and other critical debugging output invisible.

Run `bun src/server.ts` directly (without `--watch`) when debugging.

### E2E tests require `convex:local` running

Playwright's `webServer` config starts the app server but not Convex. You must have `bun run convex:local` running in the same workspace before running `bun run test:e2e`.

### `bunx @convex-dev/auth` needs a running backend

If you need to manually configure auth keys (e.g., after a fresh worktree), start `bun run convex:local` in one terminal first, then run `bunx @convex-dev/auth` in another. It won't work standalone because it talks to the Convex backend over HTTP.
