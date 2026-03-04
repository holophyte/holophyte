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

| Environment | Frontend | Convex | Companion |
|---|---|---|---|
| Local dev | `localhost:8080` | Local Convex (3210/3211) | Same Bun process |
| E2E tests | Ephemeral server | Ephemeral Convex (13210+) | Same process |
| Production | Vercel (static) | Convex Cloud | `bun run companion` on your machine |

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

### Agent Team Prompt

```
/autopilot-team

Migrate session event streaming from WebSocket to Convex subscriptions.

Context: Holophyte streams Claude Agent SDK events from the Bun server to the browser via WebSocket (ws://localhost/ws/session/:sessionId). For Vercel deployment, the frontend can't connect directly to the companion — all communication must go through Convex.

The current flow:
- src/claude/manager.ts runs the SDK iterator, calls broadcast() to push events to WS subscribers, and bufferEvent() batches events for Convex persistence every 5s
- src/frontend/hooks/useSession.ts opens a WebSocket, handles reconnection, deduplicates events between WS and Convex
- Approvals go over WebSocket: frontend sends {type: 'approve', requestId}, server calls respondToApproval()

The new flow:
- Companion writes each SDK event to Convex immediately (no batching)
- Frontend reads events via useQuery(api.sessionEvents.getBySession) — Convex subscriptions are already real-time
- Approvals go through a Convex table: frontend writes a mutation, companion subscribes and picks up the resolution
- Session status written to the sessions table in Convex, frontend reads via useQuery

What needs to change:

1. In src/claude/manager.ts:
   - Change bufferEvent() to flush immediately (per-event, not batched). The isResume path on line 343 already does this — make it the default.
   - Remove broadcast(), subscribe(), WsServerMessage type, and the subscribers Set from Session interface.
   - For canUseTool: instead of broadcasting a permission message to WS subscribers, write the pending approval to Convex (new table or field). Then poll/subscribe Convex for the resolution instead of using an in-memory Promise queue.
   - Write status changes (running/idle/failed) to the Convex session record directly.

2. In convex/:
   - Add approval storage — either a new pendingApprovals table or add approvals field to sessions. Needs: requestId, tool, input, resolved (boolean), approved (boolean), denyMessage (optional).
   - Add mutations: createApproval, resolveApproval
   - Add query: getPendingApprovals (by sessionId)
   - Consider switching sessionEvents from batch-based storage to individual event documents for better Convex reactivity (each useQuery re-fires when a new document is inserted)

3. In src/frontend/hooks/useSession.ts:
   - Remove all WebSocket code: wsRef, connect(), reconnection timer, onmessage handler, isConnected state, wsEvents state
   - Events come purely from useQuery(api.sessionEvents.getBySession) — already wired up as persistedEvents
   - Pending approvals come from useQuery(api.pendingApprovals.getBySession) or similar
   - approve() and deny() become useMutation calls instead of ws.send()
   - Session status comes from useQuery(api.sessions.get) — already partially there as sessionRecord
   - companionOnline derived from a heartbeat field on the session or a separate companion status record

4. In src/server.ts:
   - Remove the WebSocket upgrade handler for /ws/session/:sessionId
   - Remove the Bun.serve() websocket config object

5. Verify existing tests still pass (bun run test). Update src/claude/manager.test.ts if needed.

Important constraints:
- The companion (src/claude/manager.ts) communicates with Convex via HTTP endpoints (callConvexInternal pattern already exists)
- Follow existing patterns: use callConvexInternal for companion→Convex, useQuery/useMutation for frontend→Convex
- Do NOT break bun run dev:local — local development should still work
- sendMessage (follow-up messages) already goes through Convex via sessionMessages table — use that as a reference pattern
- Run bun run lint:fix before committing
```

---

## Phase 2: Decouple Companion

Strip frontend-serving code from the Bun server so it becomes a pure companion process.

### Tasks

- [ ] Remove frontend routes from `Bun.serve()` — strip `/`, `/*` catch-all routes and `/config.js` route from `src/server.ts`
- [ ] Keep companion-only routes — `/api/pick-directory`, `/api/auth/*` proxy
- [ ] Add `bun run companion` script to `package.json`
- [ ] ~Add companion heartbeat~ — ✅ partially done in Phase 1: `lastHeartbeat` field on sessions table, `batchHeartbeat` endpoint called every poll cycle. Remaining: consider a separate companion-level heartbeat (not per-session) for dashboard online/offline status when no sessions are active
- [ ] Verify — `bun run companion` starts cleanly, responds to session start requests, heartbeat visible in Convex

### Agent Team Prompt

```
/autopilot-team

Decouple the Bun server into a headless companion process.

Context: After Phase 0 (static build) and Phase 1 (WS→Convex migration), src/server.ts still serves the frontend and handles routes that only the companion needs. Strip it down to a pure companion process.

What needs to change:

1. In src/server.ts:
   - Remove the "/" route that serves public/index.html
   - Remove the "/*" catch-all route for SPA routing
   - Remove the "/config.js" route (restored in Phase 1 for dev server — not needed by companion)
   - Keep: /api/pick-directory, /api/auth/* proxy
   - Note: /api/sessions/* routes were already removed in Phase 1 (companion uses Convex polling now)
   - The server should start with a clear log: "Holophyte companion running on port {PORT}"

2. In package.json:
   - Add "companion" script: "bun run src/server.ts" (or a new entry point like src/companion.ts if cleaner)
   - Keep "dev" and "dev:local" working for local development (these should run both the build watcher AND companion)

3. Companion heartbeat (partially done):
   - Phase 1 added per-session heartbeat: `lastHeartbeat` field on sessions, `batchHeartbeat` endpoint, companion polls every 2s
   - Frontend already derives `companionOnline` from heartbeat recency (10s stale threshold)
   - Remaining: consider a companion-level heartbeat for when no sessions are active (currently companionOnline is only meaningful when a session exists)
   - If needed, add convex/companion.ts with a singleton heartbeat record

4. Verify: `bun run companion` starts cleanly without serving any frontend assets

Important constraints:
- Do NOT break bun run dev:local — for local dev, the companion should still work alongside the frontend dev server
- Use Bun APIs only, existing callConvexInternal pattern for Convex communication
- Run bun run lint:fix before committing
```

---

## Phase 3: Deploy to Vercel

Connect the repo to Vercel and verify the full loop works.

### Tasks

- [ ] Connect GitHub repo to Vercel — set framework to "Other", build command `bun run build`, output dir `dist`
- [ ] Set Vercel env vars — `CONVEX_URL` pointing to Convex Cloud deployment
- [ ] Deploy and verify — dashboard loads at Vercel URL, shows data from Convex Cloud
- [ ] Add companion status indicator — green/yellow/gray badge in the dashboard header based on heartbeat recency
- [ ] Test full loop — create task on Vercel dashboard → companion picks it up → agent runs → approve from browser → see results
- [ ] Deploy Convex to production — `bun run convex:deploy` to push functions to Convex Cloud

### Agent Team Prompt

```
/autopilot-team

Add companion status indicator to the dashboard and prepare for Vercel deployment.

Context: The frontend is now a static SPA (Phase 0), session streaming goes through Convex (Phase 1), and the companion is a standalone process (Phase 2). Add a visible companion status indicator, fix static build config, and verify everything works together.

What needs to happen:

1. Fix static build config:
   - Phase 1 reverted config.ts to window.__HOLOPHYTE_CONFIG__ (process.env doesn't work in Bun browser bundles)
   - For Vercel static builds, scripts/build.ts needs a config strategy. Options:
     a) Generate a config.js file at build time with CONVEX_URL baked in
     b) Restore the `define` block in Bun.build() to inline process.env.* at build time (config.ts would need to support both window global for dev and process.env for static)
     c) Fetch config at runtime from a Convex HTTP endpoint
   - e2eTest, allowAnonymousAuth, homeDir should all be falsy/empty in production builds

2. Add a CompanionStatus component:
   - Location: src/frontend/components/CompanionStatus.tsx
   - Reads companion heartbeat — either from the per-session lastHeartbeat (already exists from Phase 1) or a companion-level heartbeat record (if added in Phase 2)
   - Shows a small status badge in the app header (src/frontend/App.tsx):
     - Green dot + "Connected" — heartbeat within last 30s
     - Yellow dot + "Stale" — heartbeat 30s–5min ago
     - Gray dot + "Offline" — no heartbeat for 5+ min
   - Tooltip or hover showing last seen time and active session count
   - Use existing UI patterns: cn() for classNames, Tailwind for styling, lucide-react for icons

3. Add a banner or tooltip when companion is offline explaining that tasks will queue but won't execute until the companion reconnects

4. Update the "Start Session" flow to show a warning if companion is offline (task will be queued but not picked up)

Important constraints:
- Follow existing component patterns (default export, interface ComponentNameProps, cn() helper)
- Use Radix UI primitives from src/frontend/components/ui/ where appropriate
- Tailwind v4 with CSS variables (no theme() function — use var())
- Run bun run lint:fix before committing
```

---

## Phase 4: Cleanup

### Tasks

- [ ] Update `bun run dev` — local dev should start both companion + frontend dev server for convenience
- [ ] Update CLAUDE.md — document new architecture, companion command, Vercel deployment, env vars
- [ ] Update Notion board — mark "Split frontend from Bun server" and "Deploy frontend to Vercel" as Done
- [ ] Remove dead code — WebSocket types already removed in Phase 1; check for any remaining unused imports or stale references
