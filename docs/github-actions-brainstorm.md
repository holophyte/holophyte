# GitHub Actions Brainstorm

Ideas for CI/CD workflows for the Holophyte project.

---

## 1. Core CI Pipeline (PR Checks)

**Trigger:** Pull requests to `main`

A single workflow that gates every PR with the essentials:

- **Biome lint** (`bun run lint`) — catch formatting and lint errors before review
- **TypeScript type-check** (`bunx tsc --noEmit`) — strict mode means this catches real bugs
- **Vitest unit tests** (`bun run test`) — run the full unit suite including Convex tests via `convex-test`
- **Build smoke test** — verify the Bun server can start and serve a page without crashing

This is the highest-value, lowest-effort workflow to add first.

---

## 2. Playwright E2E Tests

**Trigger:** Pull requests to `main`, or nightly schedule

Harder to set up because it needs a running Convex backend. Two approaches:

- **Option A: Mock Convex** — use `convex-test` or MSW to stub the backend so no real Convex instance is needed
- **Option B: Ephemeral Convex deployment** — spin up a temporary Convex project per CI run using `convex deploy` to an isolated environment, then tear it down

Either way: install Playwright browsers via `bunx playwright install --with-deps chromium`, start the dev server, run `bun run test:e2e`.

---

## 3. Dependency Review / Security Audit

**Trigger:** Pull requests that touch `package.json` or `bun.lock`

- Use GitHub's built-in **Dependency Review Action** (`actions/dependency-review-action`) to flag known vulnerabilities in new/updated deps
- Could also run `bun audit` (or `npm audit` as a fallback) to check for CVEs
- Prevents merging PRs that introduce dependencies with known security issues

---

## 4. Bundle Size Tracking

**Trigger:** Pull requests to `main`

- Build the frontend bundle and measure its size
- Comment on the PR with a delta (e.g., "+12 KB gzipped" or "-3 KB")
- Helps prevent accidental bundle bloat from large dependencies or unshaken imports
- Could use a simple script that records sizes to a JSON file and diffs against `main`

---

## 5. Convex Schema Validation

**Trigger:** Pull requests that touch `convex/schema.ts`

- Run `convex deploy --dry-run` (or `convex dev --once` if available) to verify that schema changes are compatible with the existing database
- Flag breaking changes (removed fields, changed types) that would block a real deploy
- Could also lint for missing indexes or overly broad schemas

---

## 6. Auto-label PRs

**Trigger:** Pull requests opened/edited

- Use **actions/labeler** to auto-apply labels based on file paths:
  - `convex/**` → `backend`
  - `src/frontend/**` → `frontend`
  - `src/claude/**` → `claude-integration`
  - `e2e/**` → `e2e-tests`
  - `docs/**` → `docs`
- Keeps the PR list organized with zero manual effort

---

## 7. Convex Production Deploy

**Trigger:** Push to `main` (post-merge)

- Automatically run `convex deploy` after a PR merges to `main`
- Store `CONVEX_DEPLOY_KEY` as a GitHub secret
- Could add a Slack/Discord notification on success or failure
- Optional: add a manual approval gate via GitHub Environments for production safety

---

## 8. Nightly Health Check

**Trigger:** Cron schedule (e.g., daily at 3 AM UTC)

- Run the full test suite (unit + E2E) against `main`
- Check that `bun install` still resolves cleanly (catch yanked packages)
- Run `bunx tsc --noEmit` to verify type-checking still passes
- Notify via GitHub Issues or Slack if anything fails overnight
- Catches regressions from dependency updates or Convex platform changes

---

## 9. Release / Changelog Generation

**Trigger:** Tags matching `v*` or manual dispatch

- Auto-generate a changelog from PR titles/labels since the last tag
- Create a GitHub Release with the changelog body
- Could use **release-drafter** or a simple git-log-based script
- Useful once the project has users or deployment cadence

---

## 10. Stale Issue / PR Cleanup

**Trigger:** Cron schedule (weekly)

- Use **actions/stale** to auto-label and eventually close issues/PRs with no activity
- Configurable thresholds (e.g., 30 days stale → label, 60 days → close)
- Keeps the backlog from becoming a graveyard

---

## 11. PR Preview Deployments

**Trigger:** Pull requests to `main`

- Deploy a preview instance of the app per PR so reviewers can click around
- Since the app uses Convex, this would need an ephemeral Convex deployment + a temporary Bun server
- Could use something like Fly.io or Railway for ephemeral app instances
- Comment the preview URL on the PR automatically

---

## 12. Claude Code Integration Test

**Trigger:** Pull requests that touch `src/claude/**`

- Spin up a sandboxed environment and verify that the session manager can:
  - Initialize a Claude Agent SDK session via `query()`
  - Stream structured events through `consumeIterator()`
  - Handle tool approval flows via `canUseTool` callback
  - Clean up sessions on stop via AbortController
- This is essentially running `manager.test.ts` but could be extended to a heavier integration test with a real (or mocked) Claude Code binary

---

## Priority Ranking

| Priority | Workflow | Effort | Impact |
|----------|----------|--------|--------|
| 1 | Core CI Pipeline (lint + types + tests) | Low | High |
| 2 | Auto-label PRs | Low | Medium |
| 3 | Convex Production Deploy | Medium | High |
| 4 | Dependency Review | Low | Medium |
| 5 | Playwright E2E | Medium | High |
| 6 | Bundle Size Tracking | Medium | Medium |
| 7 | Nightly Health Check | Low | Medium |
| 8 | Convex Schema Validation | Medium | Medium |
| 9 | Release/Changelog | Low | Low |
| 10 | Stale Cleanup | Low | Low |
| 11 | PR Preview Deployments | High | High |
| 12 | Claude Code Integration Test | Medium | Medium |

---

## Recommended First Step

Start with **#1 (Core CI Pipeline)** — a single `.github/workflows/ci.yml` that runs Biome, TypeScript, and Vitest on every PR. It's ~30 lines of YAML and immediately catches the most common issues before code review.
