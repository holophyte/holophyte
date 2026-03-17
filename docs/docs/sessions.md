---
sidebar_position: 3
title: Sessions
---

# Sessions

Sessions are the core unit of interaction in Holophyte. Each session is a conversation between the user and Claude about a specific task. Sessions are **persistent** — a session you start today can be resumed hours or days later, picking up the conversation exactly where it left off.

## Lifecycle

```
queued  →  running  →  idle
                         ↓
                      (resumable)
           running  →  failed
                         ↓
                      (resumable)
           running  →  stopped  →  idle
```

| Status | Meaning |
|--------|---------|
| `queued` | Session created by the frontend, waiting for the companion to pick it up and spawn an SDK process. |
| `running` | A turn is currently in progress — Claude is working or waiting for a tool approval. An SDK process is alive and consuming backend resources. |
| `idle` | The turn completed. The SDK process has exited. No resources consumed. The session exists in Convex and can be resumed at any time. |
| `stopped` | User requested the session be stopped. The companion will abort the SDK process and transition to `idle`. |
| `failed` | The SDK process crashed or returned an error result. Still resumable — resuming starts a new turn with the prior conversation context. |

The frontend also derives a `waiting_input` status (not stored in Convex) when there are unresolved tool-use approval requests and the backend status is `running`.

There is no "archived" or "completed" terminal state. A session you are done with simply sits idle. If you later want to follow up, resume it.

## Turn Model

The backend is **stateless between turns**. When Claude finishes a response, the SDK process exits. "Idle" means the session record lives in Convex with a `sdkSessionId` — no running process, no memory, no file descriptors.

**Resume = spawn a new process.** When the user sends a follow-up message to an idle session, the backend spawns a fresh SDK process with `resume: sdkSessionId` and the new message. The SDK reloads the conversation context from its own storage and continues seamlessly.

**Active = a running process.** Only `running` sessions hold backend resources.

## Starting and Resuming

When a task page loads and its most recent session is idle, `SessionPanel` loads that session's conversation and the input box is pre-wired to resume it. No "resume" button needed — typing a message and hitting Send continues the conversation automatically.

"New session" is a secondary action available from the session dropdown, for cases where you want a fresh start on the same task.

### Session Resume Flow

1. Frontend reads the `sdkSessionId` from the Convex session record (available via `useSession` → `sdkSessionId`).
2. Frontend calls `queueResume` mutation with the session ID and new prompt. This sets the session status back to `queued` with `sdkSessionId` preserved.
3. Companion's reactive subscription detects the queued session and claims it.
4. Companion spawns a new SDK process with `options.resume = sdkSessionId` and the new prompt.
5. Frontend's `useQuery` subscriptions automatically pick up the new events and status changes — no reconnection needed.
6. Conversation continues seamlessly — the SDK reloads prior context from its own storage.

### batchIndex Continuation

Events are persisted in numbered batches (`batchIndex`). On resume, the companion fetches `nextBatchIndex` from Convex so new events sort after the previous session's history — preventing ordering gaps in the event log across resume boundaries.

## Session List per Task

Each task can have multiple sessions. A dropdown at the top of `SessionPanel` shows all sessions for the current task, sorted by `lastActivityAt` descending (most recently active first). Each entry shows:

- **Name** — first 30 characters of the initial prompt (auto-truncated with `…`)
- **Status** — `queued`, `running`, `idle`, or `failed`
- **Last activity** — relative timestamp ("just now", "2 h ago", "yesterday")

## Concurrent Session Limits

| Threshold | Behavior |
|-----------|----------|
| 5 active sessions | Warning shown in the UI; launching is still allowed |
| 10 active sessions | Hard cap; new sessions cannot be launched |

"Active" means a running SDK process. Idle sessions are just database records and do not count toward the limit.

## Kanban Indicators

Task cards on the kanban board display a small dot showing session state at a glance:

- **Green dot** — at least one session on this task is currently `running`
- **Gray dot** — one or more `idle` sessions exist, none `running`
- **No dot** — no sessions for this task

The indicators update in real time via Convex reactivity.

## Persistence and Event History

All SDK events are persisted to the `sessionEvents` table in Convex in batches (flushed every 5 seconds or when the buffer reaches 200 events). On page refresh, `useSession` loads the full event history from Convex so the conversation is always visible.

The `useSession` hook subscribes to `sessionEvents.getBySession` via Convex's reactive `useQuery`. As the companion flushes new event batches, the query automatically updates and the UI renders the latest events. No WebSocket or manual polling is needed — Convex reactivity handles real-time delivery.

## Real-time Communication

All communication between the frontend and the session happens through **Convex mutations and reactive queries** — there is no WebSocket connection between the browser and the companion server.

### Frontend → Session (via Convex mutations)

| Action | Mutation | Description |
|--------|----------|-------------|
| Create session | `sessions.create` | Inserts a `queued` session record with the prompt |
| Resume session | `sessions.queueResume` | Re-queues an `idle` session with a new prompt |
| Stop session | `sessions.requestStop` | Sets status to `stopped` for the companion to pick up |
| Approve tool | `pendingApprovals.resolve` | Marks approval as resolved with `approved: true` |
| Deny tool | `pendingApprovals.resolve` | Marks approval as resolved with `approved: false` and optional deny message |
| Send message | `sessionMessages.send` | Inserts a message for the companion to deliver to the running SDK process |

### Session → Frontend (via Convex reactive queries)

| Data | Query | Description |
|------|-------|-------------|
| Session status | `sessions.get` | Status, `sdkSessionId`, `lastHeartbeat`, model, permission mode |
| Conversation | `sessionEvents.getBySession` | All event batches ordered by `batchIndex` |
| Tool approvals | `pendingApprovals.getBySession` | Pending and resolved approval records |

The companion writes to these tables via internal HTTP endpoints, and the frontend's `useQuery` subscriptions pick up changes in real time.

## Stop

Stopping a running session works through Convex:

1. Frontend calls `sessions.requestStop` mutation, which sets the session status to `stopped`.
2. Companion's reactive subscription detects the `stopped` status.
3. Companion sets `stoppedByUser = true` on the in-memory session and aborts the SDK controller.
4. The cleanup path in `consumeIterator` detects the `stoppedByUser` flag and transitions the session to `idle` rather than `failed` — so the session remains resumable.
5. Stop does not delete the session or its history.

## Error Handling on Resume

If the `sdkSessionId` is stale or the SDK rejects the resume, the server returns an error and the UI surfaces it. The user is offered a "Start new session" option. A new session is never created silently on resume failure — the user must take an explicit action.

## Convex Schema

Relevant fields on the `sessions` table:

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `Id<'tasks'>` | Owning task |
| `status` | `'queued' \| 'running' \| 'idle' \| 'stopped' \| 'failed'` | Current lifecycle state |
| `startedAt` | `number` | Unix ms when the session was first created |
| `lastActivityAt` | `number?` | Unix ms of most recent message sent or received; used as sort key |
| `sdkSessionId` | `string?` | Opaque ID from the Claude Agent SDK `system/init` event; passed as `resume` to continue the conversation |
| `name` | `string?` | Display name — first 30 chars of the initial prompt |
| `model` | `string?` | Claude model used for this session |
| `permissionMode` | `string?` | `'default' \| 'safe-auto' \| 'bypass'` |
| `queuedPrompt` | `string?` | Stored when `status='queued'` so the companion can read the prompt on claim |
| `endedAt` | `number?` | Unix ms when the session completed or failed |
| `lastHeartbeat` | `number?` | Updated every companion poll cycle for active sessions; used for liveness detection |

## Key Queries

| Query | Purpose |
|-------|---------|
| `sessions.listByTask(taskId)` | All sessions for a task, ordered by `lastActivityAt` desc. Powers the session dropdown. |
| `sessions.getByTask(taskId)` | Most recent session for a task. Used to auto-open the latest session when a task page loads. |
| `sessions.listActive(orgId)` | All running sessions in an org. Used for the active session count display. |
| `sessions.countActive()` | Global running session count. Used for the concurrent limit check on session start. |
