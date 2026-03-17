---
sidebar_position: 2
title: Architecture
---

# Architecture

Holophyte has three layers: a **React frontend**, a **Convex real-time database**, and a **companion server** that runs on your local machine. The companion spawns Claude Code sessions via the Agent SDK and bridges them to Convex so the browser can display live progress.

## System Overview

```
┌─────────────────────────────────────────────────────┐
│                     Browser                         │
│                                                     │
│  React 19  ←→  Convex React Client  ←→  TanStack   │
│  (useQuery / useMutation)              Router       │
│                                                     │
│  Zustand (UI state)    useSession (WebSocket)       │
└────────────────┬────────────────────────────────────┘
                 │  WebSocket (real-time queries)
                 ▼
┌─────────────────────────────────────────────────────┐
│                  Convex Cloud / Local               │
│                                                     │
│  Tables: repos, tasks, sessions, sessionEvents,     │
│          pendingApprovals, sessionMessages, ...      │
│                                                     │
│  HTTP Actions: /api/internal/*                      │
│  (authenticated with INTERNAL_API_SECRET)           │
└────────────────┬────────────────────────────────────┘
                 │  HTTP + Convex WebSocket subscriptions
                 ▼
┌─────────────────────────────────────────────────────┐
│              Companion Server (Bun)                 │
│                                                     │
│  Bun.serve()     Companion Polling    Subscriptions  │
│  (SPA + routes)  (heartbeats)        (reactive)     │
│                                                     │
│  Claude Agent SDK  ←→  Session Manager              │
│  (spawns processes)    (start/stop/approve)          │
└─────────────────────────────────────────────────────┘
```

## Data Flow

### Starting a Session

1. User clicks "Start Session" on a task in the browser.
2. Frontend calls `useMutation(sessions.create)` with `status: 'queued'` and the prompt.
3. Convex inserts a queued session record.
4. The companion's reactive subscription detects the new queued session.
5. Companion claims the session (`sessions.claimQueued` mutation), changing status to `running`.
6. Companion spawns a Claude Code process via the Agent SDK with the task's prompt and repo path.
7. SDK events stream through the session manager and are persisted to `sessionEvents` in batches.
8. Frontend's `useQuery(sessionEvents.getBySession)` reactively receives the batched events and renders the conversation.

### Tool Approvals

1. Claude requests to use a tool (e.g., file edit, bash command).
2. Companion writes a `pendingApprovals` record to Convex.
3. Frontend's `useQuery` picks up the pending approval and shows an approve/deny dialog.
4. User approves or denies via `useMutation(pendingApprovals.resolve)`.
5. Companion's subscription detects the resolved approval and feeds the response back to the SDK.

### Follow-up Messages

1. User types a message while a session is running.
2. Frontend calls `useMutation(sessionMessages.send)` to insert the message.
3. Companion's subscription detects the pending message and delivers it to the SDK process.
4. The message is marked as consumed.

## Frontend

### Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 |
| Routing | TanStack Router |
| Styling | Tailwind v4 (CSS-first config) |
| Components | Radix UI + class-variance-authority |
| Icons | lucide-react |
| State | Zustand (UI-only), Convex (data) |
| Markdown | react-markdown + rehype-highlight |

### Route Structure

```
/                              → HomeRoute (org overview, all tasks)
/repos/:repoId                 → BoardRoute (kanban board)
/repos/:repoId/tasks/:taskId   → TaskDetailRoute (task detail panel)
/repos/:repoId/tasks/:taskId/page → TaskPageRoute (full task page + session)
/seeds                         → SeedsRoute (seed ideas board)
```

### Layout

`RootLayout` renders the persistent **Sidebar** on the left, with the routed content to its right. The sidebar shows:

- Organization switcher
- Repo list with task counts
- Active tasks panel (in-progress and in-review)
- Companion connection status indicator

### State Management

**Convex** handles all persistent data. The frontend uses `useQuery` for reactive reads and `useMutation` for writes — no direct `fetch()` calls to the companion server.

**Zustand** (`useAppStore`) handles transient UI state:

- Layout preferences (collapsed panels, theme) — persisted to localStorage
- Active session ID, search query, label filters — not persisted
- Bulk selection state — cleared on navigation

### Key Components

| Component | Purpose |
|-----------|---------|
| `KanbanBoard` | Drag-and-drop task columns per status |
| `TaskCard` | Individual task with status dot, labels, priority |
| `SessionPanel` | Live conversation view with message input |
| `SessionDropdown` | Switch between sessions on a task |
| `CompanionStatus` | Connection indicator (connected/stale/offline) |
| `CommandPalette` | Cmd+K quick navigation |
| `SearchFilterBar` | Text search + label filtering |
| `BulkActionBar` | Multi-select task operations |

## Convex (Database)

### Tables

| Table | Purpose |
|-------|---------|
| `organizations` | Multi-tenant orgs (each user gets a personal org) |
| `memberships` | User-to-org mapping with roles (owner/admin/member/viewer) |
| `repos` | Git repositories linked to an org by filesystem path |
| `tasks` | Kanban tasks with status, position, priority, time tracking |
| `labels` | Color-coded labels for task categorization |
| `subtasks` | Checklist items within a task |
| `seeds` | Lightweight task ideas, convertible to full tasks |
| `promptTemplates` | Reusable prompts, scoped to a repo or global |
| `promptHistory` | Audit trail of prompt changes per task |
| `sessions` | Claude Code session records with lifecycle state |
| `sessionMessages` | User follow-up messages delivered to running sessions |
| `pendingApprovals` | Tool-use approval requests awaiting user action |
| `sessionEvents` | Batched SDK event log for conversation replay |
| `companion` | Companion server heartbeat for status and duplicate detection |

### Internal HTTP Endpoints

The companion communicates with Convex via HTTP actions in `convex/http.ts`. All endpoints are POST, authenticated with a Bearer token derived from `INTERNAL_API_SECRET`.

**Session management:**
- `/api/internal/sessions/listQueued` — poll for sessions waiting to start
- `/api/internal/sessions/claimQueued` — atomically claim a queued session
- `/api/internal/sessions/listStopped` — poll for sessions the user wants stopped
- `/api/internal/sessions/updateStatus` — transition session status
- `/api/internal/sessions/updateActivity` — touch `lastActivityAt`
- `/api/internal/sessions/updateName` — set auto-generated session name
- `/api/internal/sessions/updateSdkSessionId` — store the SDK session ID after init
- `/api/internal/sessions/markStaleRunning` — recover sessions from a crashed companion
- `/api/internal/sessions/markStoppedAsIdle` — recover unprocessed stop requests
- `/api/internal/sessions/batchHeartbeat` — heartbeat for active sessions

**Messages and approvals:**
- `/api/internal/sessionMessages/listPending` — poll for undelivered messages
- `/api/internal/sessionMessages/markConsumed` — mark a message as delivered
- `/api/internal/pendingApprovals/create` — create an approval request
- `/api/internal/pendingApprovals/listResolvedUnconsumed` — poll for user responses
- `/api/internal/pendingApprovals/markConsumed` — mark an approval as consumed
- `/api/internal/pendingApprovals/denyAll` — deny all pending approvals (on session stop)

**Events and companion:**
- `/api/internal/sessionEvents/insertBatch` — persist a batch of SDK events
- `/api/internal/sessionEvents/getNextBatchIndex` — get the next batch sequence number
- `/api/internal/companion/status` — check for duplicate companion instances
- `/api/internal/companion/heartbeat` — companion liveness signal

## Companion Server

The companion is a Bun server (`src/server.ts`) that runs on the developer's machine. It serves the frontend SPA and manages Claude Code sessions.

### Responsibilities

1. **Serve the frontend** — Bun.serve() with HMR in development, SPA catch-all routing
2. **Proxy OAuth** — forward `/api/auth/*` to Convex site URL for GitHub/Google login
3. **Directory picker** — native macOS folder dialog via `osascript`
4. **Session management** — spawn/stop/resume Claude Code SDK processes
5. **Reactive subscriptions** — Convex WebSocket client watches for queued sessions, stopped sessions, pending messages, and resolved approvals
6. **Heartbeat polling** — sends periodic heartbeats for active sessions and the companion itself

### Startup Sequence

1. **Duplicate detection** — checks if another companion is already connected (within 10s heartbeat window)
2. **Stale session cleanup** — marks orphaned `running` sessions as `idle` and `stopped` sessions as `idle`
3. **Auth token loading** — reads `~/.holophyte/token.json` from `holophyte setup`
4. **Reactive subscriptions** — connects a `ConvexClient` to subscribe to queued/stopped/message/approval queries
5. **Polling loop** — starts 2-second interval for heartbeats and subscription retry

### Session Manager

`src/claude/manager.ts` manages the lifecycle of Claude Code SDK processes:

- **`startSession()`** — spawns an SDK process with a prompt, repo path, model, and permission mode. Sets up the event consumption loop.
- **`stopSession()`** — sets `stoppedByUser` flag and aborts the SDK controller. The session transitions to `idle` (not `failed`) so it remains resumable.
- **`sendMessageToSession()`** — delivers a follow-up message to a running session.
- **`getSession()`** / **`getActiveSessions()`** — query in-memory session state.

Events from the SDK flow through `consumeIterator()` which:
- Buffers events and flushes them to Convex every 5 seconds (or at 200 events)
- Creates `pendingApproval` records when the SDK requests tool use
- Updates session status on completion or failure

### Permission Modes

| Mode | Behavior |
|------|----------|
| `default` | Every tool use requires explicit user approval |
| `safe-auto` | Auto-approves "safe" bash commands (git status, ls, cat, etc.) and all file reads. Other operations require approval. |
| `bypass` | All tool uses are auto-approved without user interaction |

Safe bash patterns for `safe-auto` mode are defined in `SAFE_BASH_PATTERNS` in `src/claude/manager.ts`.
