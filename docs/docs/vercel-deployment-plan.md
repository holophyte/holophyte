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

- [#123](https://github.com/holophyte/holophyte/issues/123) — Use `companion.getStatus` query for `companionOnline` when no active sessions (Phase 3 work)
- [#125](https://github.com/holophyte/holophyte/issues/125) — Detect and reject duplicate companion instances on startup
- [#126](https://github.com/holophyte/holophyte/issues/126) — Migrate companion from polling to Convex subscriptions

---

## Phase 3: Deploy to Vercel

Connect the repo to Vercel and verify the full loop works.

### Tasks

- [x] Connect GitHub repo to Vercel — framework "Other", build command `bun run build`, output dir `dist` ✅ done manually
- [x] Set Vercel env vars — `CONVEX_URL` pointing to Convex Cloud deployment ✅ done manually
- [x] Deploy Convex to production — `bun run convex:deploy` ✅ done manually
- [ ] Fix static build config — generate `dist/config.js` at build time in `scripts/build.ts` so the existing `window.__HOLOPHYTE_CONFIG__` pattern works on Vercel without a server
- [ ] Deploy and verify — dashboard loads at Vercel URL, shows data from Convex Cloud
- [ ] Add companion status indicator — green/yellow/gray badge in the dashboard header using `api.companion.getStatus` query ([#123](https://github.com/holophyte/holophyte/issues/123))
- [ ] Test full loop — create task on Vercel dashboard → companion picks it up → agent runs → approve from browser → see results

### Agent Team Prompt

```
/autopilot-team

Fix static build config and add companion status indicator to the dashboard.

Context: The frontend is now a static SPA (Phase 0), session streaming goes through Convex (Phase 1), and the companion is a standalone process (Phase 2). Vercel is connected and Convex is deployed to production, but the Vercel build fails because there's no server to generate /config.js. Fix the static build and add a companion status indicator.

What needs to happen:

1. Fix static build config — generate config.js at build time:
   - The frontend reads config from window.__HOLOPHYTE_CONFIG__ injected via <script src="/config.js"> in public/index.html. In dev, the Bun server generates this route dynamically. On Vercel, there's no server.
   - In scripts/build.ts, AFTER Bun.build() completes, generate a dist/config.js file that writes window.__HOLOPHYTE_CONFIG__ with values from build-time env vars:
     - convexUrl: read from process.env.CONVEX_URL (required — fail the build if missing)
     - e2eTest: false (always false in production)
     - allowAnonymousAuth: false (always false in production)
     - homeDir: '' (not applicable on Vercel — no local filesystem)
   - The existing public/index.html already has <script src="/config.js"> so it will load the generated file from dist/. No changes needed to index.html or config.ts.
   - Do NOT modify src/frontend/lib/config.ts — the window.__HOLOPHYTE_CONFIG__ pattern stays as-is.
   - Do NOT modify the /config.js route in src/server.ts — that's still used for local dev.
   - Verify: `CONVEX_URL=https://example.convex.cloud bun run build` should produce dist/config.js containing window.__HOLOPHYTE_CONFIG__={convexUrl:"https://example.convex.cloud",...}

2. Add a CompanionStatus component:
   - Location: src/frontend/components/CompanionStatus.tsx
   - Reads companion heartbeat from useQuery(api.companion.getStatus) — added in Phase 2 (convex/companion.ts). Returns { lastSeen, activeSessionCount, machineId } or null.
   - Shows a small status badge in the app header (src/frontend/App.tsx):
     - Green dot + "Connected" — lastSeen within last 30s
     - Yellow dot + "Stale" — lastSeen 30s–5min ago
     - Gray dot + "Offline" — no heartbeat for 5+ min, or getStatus returns null
   - Tooltip or hover showing last seen time and active session count
   - Use existing UI patterns: cn() for classNames, Tailwind for styling, lucide-react for icons

3. Add a banner or tooltip when companion is offline explaining that tasks will queue but won't execute until the companion reconnects

4. Update the "Start Session" flow to show a warning if companion is offline (task will be queued but not picked up)

Important constraints:
- Follow existing component patterns (default export, interface ComponentNameProps, cn() helper)
- Use Radix UI primitives from src/frontend/components/ui/ where appropriate
- Tailwind v4 with CSS variables (no theme() function — use var())
- Do NOT break bun run dev:local — the /config.js server route still handles local dev
- Run bun run lint:fix before committing
- Make sure to test as much as possible manually before sending the PR or when iterating on PR comments
- Do not merge the PR until I've reviewed it manually
```

---

## Phase 4: Cleanup

### Tasks

- [ ] Update `bun run dev` — local dev should start both companion + frontend dev server for convenience
- [ ] Update CLAUDE.md — document new architecture, companion command, Vercel deployment, env vars
- [ ] Update Notion board — mark "Split frontend from Bun server" and "Deploy frontend to Vercel" as Done
- [ ] Remove dead code — WebSocket types already removed in Phase 1; check for any remaining unused imports or stale references
