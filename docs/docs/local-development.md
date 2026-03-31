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
5. Local Convex provisioning on the worktree's assigned ports

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

Isolation between worktrees is **port-based**. Each workspace binds its local Convex backend to unique `CONVEX_CLOUD_PORT`/`CONVEX_SITE_PORT` values from `.dev-ports`, so even if two workspaces share a deployment name, their data and connections are fully separate.

The deployment identity is stored in `.env.local`:

```
CONVEX_DEPLOYMENT=local:local-ko_vial-holophyte-1
CONVEX_URL=http://127.0.0.1:3212
CONVEX_SITE_URL=http://127.0.0.1:3213
```

### Deployment names are not unique per worktree

Convex assigns deployment names incrementally (e.g., `local-ko_vial-holophyte`, `-1`, `-2`). These names are controlled by Convex — `convex dev --configure existing` picks the next available name for the project and there is no flag to specify a custom one. Two worktrees may end up with deployment names that look similar or share a suffix.

**This is fine.** The deployment name determines the on-disk data directory (`~/.local/share/convex/<name>`), but each worktree's Convex instance binds to different ports. As long as ports are unique (guaranteed by the `.dev-ports` allocation), the worktrees are fully isolated.

### How Fresh Deployments Are Provisioned

`worktree-create.sh` does **not** copy `.env.local` from main. Instead, it lets `convex dev --configure existing` generate a fresh `.env.local` with a new deployment name and the worktree's assigned ports. Non-Convex vars (API keys, secrets) are saved beforehand and appended after provisioning.

### Stale Deployment Detection

`convex-local.sh` validates that `CONVEX_URL` in `.env.local` matches the expected port from `.dev-ports`. If there's a mismatch (e.g., `.env.local` points to port 3210 but `.dev-ports` says 3218), it strips the stale vars and reconfigures automatically.

## E2E Tests in Worktrees

Playwright E2E tests (`bun run test:e2e`) work in worktrees with some considerations:

- The E2E server runs on `DEV_PORT + 1` (read from `.dev-ports`)
- `playwright.config.ts` passes `CONVEX_URL` derived from `.dev-ports` to the E2E web server, ensuring it connects to the correct local Convex instance
- E2E tests spin up their own ephemeral Convex — `convex:local` must **not** be running (or use `test:e2e:isolated` below)

### Running E2E without stopping dev Convex (`test:e2e:isolated`)

If stopping `convex:local` is inconvenient, use the isolated E2E command from the **main repo** (not a worktree):

```bash
bun run test:e2e:isolated [playwright args...]
```

What it does:

1. Creates a detached-HEAD worktree at `~/.holophyte-dev/e2e-<timestamp>`
2. Copies `.env` and writes a `.dev-ports` with `CONVEX_TEAM`/`CONVEX_PROJECT` from the main repo and high dummy ports — so `e2e-convex.sh`'s "is dev Convex running?" check passes without conflicting with your real dev backend
3. Runs `bun install --frozen-lockfile` in the worktree
4. Delegates to `scripts/test-e2e.sh` inside the worktree, which provisions its own ephemeral Convex backend on different ports
5. Removes the worktree unconditionally on exit — even on Ctrl+C or test failure

Your main repo's `.env.local` is never modified and your dev Convex keeps running throughout.

## First-Time Setup

If you're setting up a fresh clone, run:

```bash
bun run setup:local
```

This interactive script creates `.dev-ports`, provisions a local Convex backend, generates auth keys, and sets all required environment variables. You can re-run it at any time to fix a broken configuration.

For worktrees, use `bun run worktree:create <name>` instead — it handles setup automatically.

## Environment Variable Reference

### `.dev-ports` (per-workspace, gitignored)

Every workspace (main repo or worktree) needs this file. Created automatically by `bun run setup:local` or `bun run worktree:create`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DEV_PORT` | Yes | `8080` | Bun app server port |
| `CONVEX_CLOUD_PORT` | Yes | `3210` | Local Convex cloud port |
| `CONVEX_SITE_PORT` | Yes | `3211` | Local Convex site / HTTP actions port |
| `CONVEX_TEAM` | Yes | — | Convex team slug (prevents [silent cloud connection](#convex-dev---local-silently-connects-to-cloud)) |
| `CONVEX_PROJECT` | Yes | — | Convex project name |

### `.env.local` (managed by `convex dev`, do not edit manually)

| Variable | Set By | Description |
|----------|--------|-------------|
| `CONVEX_DEPLOYMENT` | `convex dev` | Local deployment identity (e.g. `local:local-ko_vial-holophyte-1`) |
| `CONVEX_URL` | `convex dev` | Convex cloud URL (e.g. `http://127.0.0.1:3210`) |
| `CONVEX_SITE_URL` | `convex dev` | Convex site URL (e.g. `http://127.0.0.1:3211`) |

Non-Convex vars (API keys, secrets) are preserved across reconfiguration — `convex-local.sh` and `worktree-create.sh` both save and restore them when `convex dev` overwrites this file.

### `.env` (shared config, gitignored)

| Variable | Set By | Description |
|----------|--------|-------------|
| `INTERNAL_API_SECRET` | `setup:local`, `convex-local.sh`, `worktree-create.sh` | Shared secret for companion server to Convex internal HTTP auth |

### Convex Deployment Environment Variables

These are set on the Convex deployment itself (via `bunx convex env set`), not in local files.

| Variable | Set By | Description |
|----------|--------|-------------|
| `ALLOW_PASSWORD_AUTH` | `setup:local`, `dev-local.sh` (process env), `worktree-create.sh` (Convex env) | Enables password auth for local dev and E2E tests. Powers `?auth` auto-login with `dev@holophyte.test` / `password`. Required for the `AutoTestAuth` component and `bun run test:e2e`. |
| `ALLOW_ANONYMOUS_AUTH` | `setup:local`, `dev-local.sh` (process env), `worktree-create.sh` (Convex env) | Enables anonymous auth as a fallback (e.g. MCP server local dev). `bun run dev:local` sets both `ALLOW_PASSWORD_AUTH` and `ALLOW_ANONYMOUS_AUTH`. |
| `INTERNAL_API_SECRET` | `setup:local`, `convex-local.sh`, `worktree-create.sh` | Must match the value in `.env` — used to authenticate companion HTTP calls |
| `SITE_URL` | `setup:local`, `worktree-create.sh` | OAuth redirect base URL (e.g. `http://localhost:8082`) |
| `JWT_PRIVATE_KEY` | `bunx @convex-dev/auth` | Auth token signing key |
| `JWKS` | `bunx @convex-dev/auth` | JSON Web Key Set for token verification |

### Optional: OAuth Credentials (Convex deployment env)

Only needed if you're testing OAuth login locally. Set these in `.dev-ports` to have `setup:local` or `worktree-create.sh` forward them automatically, or set them manually with `bunx convex env set`.

| Variable | Description |
|----------|-------------|
| `AUTH_GITHUB_ID` | GitHub OAuth app client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth app client secret |
| `AUTH_GOOGLE_ID` | Google OAuth app client ID |
| `AUTH_GOOGLE_SECRET` | Google OAuth app client secret |

### Which Scripts Set What

| Script | What it configures |
|--------|-------------------|
| `setup:local` | `.dev-ports`, local Convex provisioning, `INTERNAL_API_SECRET`, auth keys, `ALLOW_PASSWORD_AUTH`, `ALLOW_ANONYMOUS_AUTH`, `SITE_URL`, OAuth credentials |
| `convex-local.sh` | `INTERNAL_API_SECRET` (in `.env` + Convex env), stale deployment detection/reconfiguration |
| `dev-local.sh` | `ALLOW_PASSWORD_AUTH` + `ALLOW_ANONYMOUS_AUTH` (process env), starts app server + Convex via `convex-local.sh` |
| `worktree-create.sh` | `.dev-ports` (port allocation), Convex provisioning, `INTERNAL_API_SECRET`, `SITE_URL`, `ALLOW_PASSWORD_AUTH`, `ALLOW_ANONYMOUS_AUTH`, auth keys, OAuth credentials |

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

### E2E tests conflict with `convex:local`

`bun run test:e2e` spins up its own ephemeral Convex, so `convex:local` must **not** be running — the Convex CLI refuses to provision when another local backend is active.

To run E2E without stopping dev Convex, use `bun run test:e2e:isolated` from the main repo — it runs in an isolated worktree without touching your dev environment. See [Running E2E without stopping dev Convex](#running-e2e-without-stopping-dev-convex-teste2eisolated) above.

### `bunx @convex-dev/auth` needs a running backend

`bunx @convex-dev/auth` sets JWT keys on the Convex deployment over HTTP, so it requires a running backend. Fresh worktrees handle this automatically (`worktree-create.sh` starts a temporary backend, runs the command, then stops it). If you ever need to re-run it manually, start `bun run convex:local` in one terminal first, then run `bunx @convex-dev/auth` in another.
