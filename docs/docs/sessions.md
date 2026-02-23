---
sidebar_position: 2
title: Sessions
---

# Sessions

Sessions are the core unit of interaction in Holophyte. Each session is a conversation between the user and Claude about a specific task. Sessions are **persistent** — a session you start today can be resumed hours or days later, picking up the conversation exactly where it left off.

## Lifecycle

```
running  →  idle
              ↓
           (deleted)
```

| Status | Meaning |
|--------|---------|
| `running` | A turn is currently in progress — Claude is working or waiting for a tool approval. An SDK process is alive and consuming backend resources. |
| `idle` | The turn completed. The SDK process has exited. No resources consumed. The session exists in Convex and can be resumed at any time. |
| `failed` | The SDK process crashed or returned an error result. Still resumable — resuming starts a new turn with the prior conversation context. |

There is no "archived" or "completed" terminal state. A session you are done with simply sits idle. If you later want to follow up, resume it.

## Turn Model

The backend is **stateless between turns**. When Claude finishes a response, the SDK process exits. "Idle" means the session record lives in Convex with a `sdkSessionId` — no running process, no memory, no file descriptors.

**Resume = spawn a new process.** When the user sends a follow-up message to an idle session, the backend spawns a fresh SDK process with `resume: sdkSessionId` and the new message. The SDK reloads the conversation context from its own storage and continues seamlessly.

**Active = a running process.** Only `running` sessions hold backend resources.

## Starting and Resuming

When a task page loads and its most recent session is idle, `SessionPanel` loads that session's conversation and the input box is pre-wired to resume it. No "resume" button needed — typing a message and hitting Send continues the conversation automatically.

"New session" is a secondary action available from the session dropdown, for cases where you want a fresh start on the same task.

## Session List per Task

Each task can have multiple sessions. A dropdown at the top of `SessionPanel` shows all sessions for the current task, sorted by `lastActivityAt` descending (most recently active first). Each entry shows:

- **Name** — first 30 characters of the initial prompt (auto-truncated with `…`)
- **Status** — `running`, `idle`, or `failed`
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

All SDK events are persisted to the `sessionEvents` table in Convex in batches (flushed every 5 seconds or when the buffer reaches 200 events). On page refresh or reconnect, `useSession` replays the persisted event history from Convex so the full conversation is always visible.

## Stop

Stopping a running session (`POST /api/sessions/:id/stop`) aborts the SDK process. The session transitions to `idle` — it remains resumable. Stop does not delete the session or its history.

## Error Handling on Resume

If the `sdkSessionId` is stale or the SDK rejects the resume, the server returns an error and the UI surfaces it. The user is offered a "Start new session" option. A new session is never created silently on resume failure — the user must take an explicit action.

## Convex Schema

Relevant fields on the `sessions` table:

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `Id<'tasks'>` | Owning task |
| `status` | `'running' \| 'idle' \| 'failed'` | Current lifecycle state |
| `startedAt` | `number` | Unix ms when the session was first created |
| `lastActivityAt` | `number` | Unix ms of most recent message sent or received; used as sort key |
| `sdkSessionId` | `string?` | Opaque ID from the Claude Agent SDK `system/init` event; passed as `resume` to continue the conversation |
| `name` | `string?` | Display name — first 30 chars of the initial prompt |
| `model` | `string?` | Claude model used for this session |
| `permissionMode` | `string?` | `'default' \| 'safe-auto' \| 'bypass'` |

## Key Queries

| Query | Purpose |
|-------|---------|
| `sessions.listByTask(taskId)` | All sessions for a task, ordered by `lastActivityAt` desc. Powers the session dropdown. |
| `sessions.getByTask(taskId)` | Most recent session for a task. Used to auto-open the latest session when a task page loads. |
| `sessions.listActive(orgId)` | All running sessions in an org. Used for the active session count display. |
| `sessions.countActive()` | Global running session count. Used for the concurrent limit check on session start. |
