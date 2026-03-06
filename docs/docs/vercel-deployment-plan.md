# Vercel Deployment Plan

Split Holophyte into a static React SPA on Vercel + a local companion process, communicating through Convex.

## Architecture

```
┌─────────────────────────┐
│    Vercel (Static SPA)  │
│    React 19 + Tailwind  │
└───────────┬─────────────┘
            │
     Convex Cloud
     (real-time sync)
            │
┌───────────┴─────────────┐
│   Local Companion (Bun) │
│   Claude Agent SDK      │
│   Filesystem / Git      │
└─────────────────────────┘
```

| Environment | Frontend         | Convex                    | Companion                           |
| ----------- | ---------------- | ------------------------- | ----------------------------------- |
| Local dev   | `localhost:8080` | Local Convex (3210/3211)  | Same Bun process                    |
| E2E tests   | Ephemeral server | Ephemeral Convex (13210+) | Same process                        |
| Production  | Vercel (static)  | Convex Cloud              | `bun run companion` on your machine |

---

## Phase 0: Build Pipeline ✅

Completed in [#121](https://github.com/holophyte/holophyte/pull/121).

### What was done

- [x] **`bun run build`** — `scripts/build.ts` calls `Bun.build()` with HTML entrypoint (`public/index.html`), `bun-plugin-tailwind`, minification, linked sourcemaps. Outputs to `dist/`. Cleans stale output before each build.
- [x] **Config migration** — ⚠️ **Reverted in Phase 1.** The `process.env.*` approach broke Bun's dev server (browser bundles don't have `process`). Restored `window.__HOLOPHYTE_CONFIG__` injected via `/config.js` route. The `define` block was removed from `scripts/build.ts` — Phase 3 will need a different static config strategy (e.g., generate `config.js` at build time or restore `define`).
- [x] **HTML cleanup** — ⚠️ **Partially reverted in Phase 1.** `document.write('/config.js')` and the `/config.js` route were restored (needed for dev server config injection).
- [x] **`vercel.json`** — SPA catch-all rewrite, `buildCommand: "bun run build"`, `outputDirectory: "dist"`.
- [x] **Bonus fix** — `INTERNAL_API_SECRET` duplicate prevention in `convex-local.sh`, `worktree-create.sh`, `setup-local.sh` (replace-or-append instead of blind append).

---

## Phase 1: Session Streaming → Convex ✅

Completed in commits `2a8c061`–`9a0f6c7` on main.

### What was done

- [x] **Per-event Convex writes** — `bufferEvent()` now calls `flushEvents()` immediately on every event instead of batching on a 5s interval. Removed `FLUSH_INTERVAL_MS`, `MAX_BUFFER_SIZE`, and the periodic flush timer.
- [x] **`pendingApprovals` table** — new `convex/pendingApprovals.ts` with 6 functions: `serverCreate`, `serverListResolvedUnconsumed`, `serverMarkConsumed`, `serverDenyAll` (internal, for companion polling), `getBySession`, `resolve` (public, auth-gated via session→task→repo→org membership chain). Schema: `sessionId`, `requestId`, `tool`, `input`, `resolved`/`consumed` double-flag pattern, `approved`, `denyMessage`.
- [x] **Convex HTTP routes** — 5 new internal HTTP endpoints in `convex/http.ts` for pending approval CRUD and `batchHeartbeat`.
- [x] **`canUseTool` rewrite** — companion writes pending approval to Convex via `callConvexInternal`, then polls every 500ms via `queryConvexInternal` for resolution. On abort signal: clears interval, resolves with deny. On session end: `denyAll` cleans up remaining approvals.
- [x] **`useSession` hook rewrite** — removed all WebSocket code (~150 lines: `wsRef`, `connect()`, reconnection timer, `onmessage`, `isConnected`, `wsEvents`, event deduplication). Events from `useQuery(api.sessionEvents.getBySession)`, approvals from `useQuery(api.pendingApprovals.getBySession)`, approve/deny via `useMutation(api.pendingApprovals.resolve)`.
- [x] **Companion heartbeat** — `lastHeartbeat` field on sessions table, updated every poll cycle via `batchHeartbeat` endpoint. Frontend derives `companionOnline` from heartbeat recency (10s stale threshold, 5s refresh interval).
- [x] **Session status from Convex** — `sessionStatus` derived from `useQuery(api.sessions.get)` with `waiting_input` computed from unresolved approvals.
- [x] **WebSocket removal** — removed `WsData` interface, `Bun.serve<WsData>` generic, WebSocket upgrade block, `websocket` config, `broadcast()`, `subscribe()`, `respondToApproval()`, `WsServerMessage` type, `persistenceWarning` from `SessionPanel.tsx`.
- [x] **Config fix** — reverted `config.ts` from `process.env.*` (broken in browser) back to `window.__HOLOPHYTE_CONFIG__` injected via `/config.js` route. This was a regression from Phase 0's PR.
- [x] **E2E fixes** — fixed global-setup selectors (Browse button, input value assertion), added JWT key generation for fresh isolated worktrees (`@convex-dev/auth --skip-git-check`), copied `convex/_generated/` to worktrees, fixed count badge test for parallel worker stability.
- [x] **Tests updated** — manager.test.ts rewritten (approval tests mock Convex HTTP, concurrent limit + session naming tests preserved), useSession.test.ts rewritten (42 tests for Convex-based flows), deleted stale `manager.rethink.test.ts`. All 364 unit tests + 34 E2E tests pass.

---

## Phase 2: Decouple Companion ✅

Completed in [#122](https://github.com/holophyte/holophyte/pull/122).

### What was done

- [x] **Separate companion entry point** — created `src/companion.ts` as a headless `Bun.serve()` with only `/api/pick-directory` and `/api/auth/*` routes. No HTML import, no HMR, no `/config.js`. `src/server.ts` stays unchanged for `bun run dev:local`.
- [x] **Shared module extraction** — split `src/server.ts` into reusable modules under `src/server/`: `convex-client.ts` (Convex internal API helpers), `polling.ts` (companion polling loop), `routes.ts` (pick-directory and auth proxy handlers). Both entry points import from these.
- [x] **Companion heartbeat** — new `companion` table in Convex schema (`lastSeen`, `activeSessionCount`, `machineId`), `convex/companion.ts` with `upsertHeartbeat` (internal mutation) and `getStatus` (auth-gated query), HTTP endpoint at `/api/internal/companion/heartbeat`. Heartbeat fires every poll cycle even with zero active sessions.
- [x] **Graceful shutdown** — both `src/server.ts` and `src/companion.ts` handle `SIGTERM` alongside `SIGINT` for production environments.
- [x] **Machine identification** — `machineId` populated from `MACHINE_ID` env var or `os.hostname()` in heartbeat calls.
- [x] **`bun run companion`** — new script in `package.json`. Existing `dev`, `dev:local`, `dev:all` scripts unchanged.
- [x] **Bonus fix** — `serverListResolvedUnconsumed` in `convex/pendingApprovals.ts` now uses the `by_session_unresolved` index to pre-filter `resolved=true` at the database level instead of fetching all approvals and filtering in JS.
- [x] **Tests pass** — 364 unit tests + 34 E2E tests pass. Lint and typecheck clean.

### Open issues

- ~~[#123](https://github.com/holophyte/holophyte/issues/123) — Use `companion.getStatus` query for `companionOnline` when no active sessions~~ ✅ resolved in [#128](https://github.com/holophyte/holophyte/pull/128)
- [#125](https://github.com/holophyte/holophyte/issues/125) — Detect and reject duplicate companion instances on startup
- [#126](https://github.com/holophyte/holophyte/issues/126) — Migrate companion from polling to Convex subscriptions

---

## Phase 3: Deploy to Vercel ✅

Completed in [#128](https://github.com/holophyte/holophyte/pull/128).

### What was done

- [x] **Static build config** — `scripts/build.ts` generates `dist/config.js` with `window.__HOLOPHYTE_CONFIG__` from build-time env vars. `CONVEX_URL` required (fail-fast at top of script). `e2eTest` and `allowAnonymousAuth` hardcoded to `false` (dev-only features). `homeDir` set to `''` (legacy, see [#130](https://github.com/holophyte/holophyte/issues/130)).
- [x] **Production Convex deploy** — `scripts/build.ts` runs `bunx convex deploy` when `VERCEL_ENV === 'production'`, with `CONVEX_DEPLOY_KEY` pre-flight check. Keeps frontend and backend deployments in sync.
- [x] **CompanionStatus component** — `src/frontend/components/CompanionStatus.tsx` in sidebar with green/yellow/gray dot + label. Tooltip shows last seen time, active session count, and stale/offline warnings. Skeleton loading state while Convex query resolves.
- [x] **`useCompanionStatus` hook** — `src/frontend/hooks/useCompanionStatus.ts` with shared 5-second clock via `useSyncExternalStore` singleton (single timer across all consumers). Derives `loading | connected | stale | offline` from heartbeat age.
- [x] **ClaudeButton offline warning** — shows alert for both `offline` and `stale` states. Launch button disabled during `loading` state ([#131](https://github.com/holophyte/holophyte/issues/131)).
- [x] **`convex/_generated/` committed to git** — Convex codegen can't run in CI/Vercel, so generated types are checked in. Pre-commit hook auto-runs codegen and stages output. CI drift check catches stale files.
- [x] **CI codegen drift check** — new `codegen-check` job in `.github/workflows/ci.yml` runs codegen then verifies no git diff. `continue-on-error` on codegen step for fork PRs, with step outcome check to catch real failures on internal branches. Secrets passed via env vars per GitHub security hardening.
- [x] **Vercel deploys successfully** — dashboard loads at Vercel URL, shows data from Convex Cloud.

### Open issues

- [#129](https://github.com/holophyte/holophyte/issues/129) — Convex preview backends for Vercel preview deployments
- [#130](https://github.com/holophyte/holophyte/issues/130) — Remove `homeDir` from frontend config (legacy, not meaningful on Vercel)
- [ ] Test full loop — create task on Vercel dashboard → companion picks it up → agent runs → approve from browser → see results

---

## Phase 4: Cleanup

### Tasks

- [ ] Update `bun run dev` — local dev should start both companion + frontend dev server for convenience
- [ ] Update CLAUDE.md — document new architecture, companion command, Vercel deployment, env vars
- [ ] Update Notion board — mark "Split frontend from Bun server" and "Deploy frontend to Vercel" as Done
- [ ] Remove dead code — WebSocket types already removed in Phase 1; check for any remaining unused imports or stale references
