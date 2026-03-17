---
sidebar_position: 4
title: Companion Server
---

# Companion Server

The companion is a Bun server that runs on the developer's local machine. It bridges the browser-based frontend with Claude Code by spawning SDK processes, persisting events to Convex, and handling tool approvals. The frontend never talks to the companion directly — all communication flows through Convex.

## Why a Companion?

Claude Code sessions need access to the local filesystem, shell, and git. These operations can't run in a browser or in Convex's serverless environment. The companion runs locally with full machine access and uses Convex as a message bus:

```
Browser  ←→  Convex  ←→  Companion  ←→  Claude Agent SDK  ←→  filesystem/shell
```

## Startup Sequence

When the companion starts (`src/server.ts` → `startCompanion()`), it runs five steps:

### 1. Duplicate Detection

Checks the `companion` table in Convex for a recent heartbeat from a different machine. If another companion was seen within the last 10 seconds, the process exits with an error. This prevents two companions from claiming the same sessions.

> **Note:** This is an advisory check with a small TOCTOU window — two companions starting within the same poll interval can both pass before either writes a heartbeat. In practice this is unlikely.

### 2. Stale Session Cleanup

Recovers sessions left in inconsistent states from a prior crash:
- `running` → `idle`: SDK process died without completing the turn
- `stopped` → `idle`: stop request was never processed

### 3. Auth Token Loading

Reads `~/.holophyte/token.json` (created by `bun run setup`) to authenticate the companion as a specific user. This allows Convex functions that require user identity to work.

### 4. Reactive Subscriptions

Connects a `ConvexClient` (WebSocket) to subscribe to three reactive queries:

| Subscription | Query | On Update |
|-------------|-------|-----------|
| Queued sessions | `sessions.companionListQueued` | Claims and starts each session |
| Stopped sessions | `sessions.companionListStopped` | Aborts the SDK process or transitions to `idle` |
| Pending messages | `sessionMessages.companionListPending` | Delivers messages to running SDK processes |

Subscriptions fire immediately when data changes — no polling delay. The companion also subscribes for resolved approval results to feed back to the SDK.

### 5. Polling Loop

Starts a 2-second interval (`POLL_INTERVAL_MS`) that handles:
- **Session heartbeats** — calls `batchHeartbeat` for all active sessions
- **Subscription retry** — if subscriptions errored or disconnected, tears them down and reconnects
- **Companion heartbeat** — writes `lastSeen` to the `companion` table so the frontend can show connection status

## Session Lifecycle on the Companion

### Claiming a Queued Session

When the subscription fires with a new queued session:

1. Skip if the session is already in the local session map or has an in-flight claim
2. Call `sessions.claimQueued` mutation (atomic — prevents double-claims)
3. Call `startSession()` in the session manager
4. On failure, mark the session as `failed`

### Running a Session

The session manager (`src/claude/manager.ts`) spawns an SDK process and runs `consumeIterator()`:

- **Events** are buffered in memory and flushed to `sessionEvents.insertBatch` every 5 seconds or at 200 events
- **Tool approvals** are written as `pendingApprovals` records; the companion polls for resolved approvals to feed back to the SDK
- **Status updates** are persisted via `sessions.updateStatus`
- **Session name** is auto-generated from the first 30 characters of the initial prompt

### Stopping a Session

When the subscription fires with a stopped session:

1. If the session is running locally, call `stopSession()` → sets `stoppedByUser = true`, aborts the SDK controller
2. Wait up to 10 seconds for the session to exit (via `waitForSessionGone`)
3. If the session isn't running locally (e.g., from a prior crash), directly transition to `idle`

### Follow-up Messages

When the subscription fires with a pending message:

1. Call `sendMessageToSession()` to inject the text into the running SDK process
2. Mark the message as consumed in Convex

## Authentication

The companion authenticates with Convex in two ways:

### Internal HTTP Endpoints

All `/api/internal/*` HTTP actions use Bearer token authentication with `INTERNAL_API_SECRET`. The companion sends the raw secret; Convex validates it via constant-time comparison in `validateSecret()`.

### Reactive Subscriptions

The `ConvexClient` can't use Bearer tokens. Instead, the companion derives an HMAC token from `INTERNAL_API_SECRET`:

```
HMAC-SHA256(INTERNAL_API_SECRET, "holophyte-companion-v1") → hex string
```

This derived token is passed as an argument to the `companion*` queries. Convex-side validation uses the same derivation (`validateCompanionToken` in `convex/lib/validateSecret.ts`). The token is static (no time component) so subscriptions don't need to re-authenticate.

> **Important:** Both `src/server/subscriptions.ts` and `convex/lib/validateSecret.ts` contain identical derivation logic. They can't share a module because Convex and Bun run in separate bundler contexts. Changes to one must be mirrored in the other.

### User Auth Token

For operations requiring user identity, the companion uses the token from `~/.holophyte/token.json` (created by `bun run setup`). This is passed to `convexClient.setAuth()` so Convex functions see the companion as acting on behalf of a real user. The token is validated against the deployment URL — if it was saved for a different deployment, it's skipped with a warning.

## In-Flight Deduplication

Subscription callbacks can fire multiple times before an operation completes (e.g., a heartbeat triggers a re-evaluation). The companion tracks in-flight operations with three `Set`s:

- `inFlightClaims` — sessions currently being claimed
- `inFlightStops` — sessions currently being stopped
- `inFlightMessages` — messages currently being delivered

Each handler checks its set before proceeding and cleans up via `finally` blocks. These sets are intentionally **not** cleared on `stopCompanionSubscriptions()` — handlers still mid-`await` clean up their own IDs.

## Connection Status in the UI

The frontend's `useCompanionStatus` hook derives a connection state from the companion's heartbeat:

| State | Condition |
|-------|-----------|
| `loading` | Query hasn't resolved yet |
| `connected` | Heartbeat within 30 seconds |
| `stale` | Heartbeat between 30 seconds and 5 minutes old |
| `offline` | No heartbeat or older than 5 minutes |

The `CompanionStatus` component in the sidebar shows a color-coded indicator.

## Error Recovery

The companion is designed to recover from transient failures:

- **Subscription errors** increment an error counter; the polling loop detects this and reconnects
- **Convex unavailability** during startup is silently skipped — the polling loop retries
- **Network failures** on heartbeats are best-effort (no logging for every failure)
- **Crashed SDK processes** are cleaned up on next startup via stale session recovery

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONVEX_URL` | Yes | Convex deployment URL |
| `CONVEX_SITE_URL` | Yes | Convex site URL for HTTP actions and auth proxy |
| `INTERNAL_API_SECRET` | Yes | Shared secret for companion ↔ Convex auth |
| `PORT` | No | Server port (default: `8080`) |
| `MACHINE_ID` | No | Identifier for duplicate detection (default: hostname) |
| `ALLOWED_ORIGIN` | No | CORS origin for the directory picker endpoint |
