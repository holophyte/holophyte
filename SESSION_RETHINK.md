# Session Model Rethink

Brainstorm doc. Phases 1-2.5 are done. Phase 3+4 are being rethought — this captures the new direction.

## Core Insight

Sessions aren't ephemeral runs. They're **persistent conversations** tied to a task. You start a conversation with Claude about implementing auth, come back hours later to follow up, resume it days later to add refresh tokens. Same session, same context.

The SDK's `resume` capability supports this — pass the `sdkSessionId` and pick up where you left off. The plumbing is already wired (Phase 1 persists `sdkSessionId` to Convex, `startSession()` accepts `resumeSdkSessionId`). What's missing is the UX.

## Session Lifecycle

```
Active  →  Idle
            ↓
         Deleted
```

- **Active** — a turn is currently running (Claude is working or waiting for approval)
- **Idle** — turn finished, waiting for the user. No timeout. Sits here indefinitely. Always resumable.
- **Failed** — SDK error or crash. Still resumable (resume starts a new turn with context).
- **Deleted** — gone, session + event history removed.

**Key change from current behavior:** Remove the 60-second idle timeout (`IDLE_TIMEOUT_MS` in `manager.ts`). An idle session is just a conversation you haven't replied to yet.

**Simplified backend statuses:** The schema status field simplifies from `'running' | 'completed' | 'failed' | 'stopped'` to `'running' | 'idle' | 'failed'`. Both "completed" (turn finished) and "stopped" (user stopped) collapse into `idle` — they're all resumable. `running` maps to Active.

There is no "archived" state. If you're done with a session, you just stop talking to it. It sits idle. If you ever want to come back, you can.

## Backend: Stateless Between Turns

The backend doesn't keep processes alive between turns. When a turn completes (Claude finishes responding), the SDK process exits. "Idle" means the session record exists in Convex with a `sdkSessionId` — no running process, no resources consumed.

**Resume = spawn a new process.** When the user sends a message to an idle session, the backend spawns a new SDK process with `resume: sdkSessionId` + the user's new message. This is how `claude --continue` works in the CLI.

**Active = a running process.** Only active sessions consume backend resources. Idle sessions are just database records.

**Error handling on resume:** If the `sdkSessionId` is stale or the SDK rejects the resume, show an error and offer "Start new session." Don't silently create a new session — the user should know context was lost.

**Disconnected approval handling:** If the user closes the browser while a session is waiting for tool approval, the SDK process is alive and blocked on the `canUseTool` callback. The backend waits ~5 minutes for WS reconnection. If the user doesn't come back, the process is killed and the session goes idle. On return, the user sees the session is idle and can resume — Claude picks up where it left off and will likely re-attempt the tool, giving a fresh approval prompt. No zombie processes, no surprising auto-denials.

## MVP

### 1. Remove idle timeout

Sessions persist after a turn completes. The backend process can exit, but the session stays idle in Convex with its `sdkSessionId` for future resume.

### 2. Resume as default behavior

When you open a task that has an idle session, the most recent session's conversation loads. The input box at the bottom resumes *that session* when you type — no extra "resume" button needed. It just continues the conversation.

"New session" is a secondary action (button in the session dropdown or next to the input). 90% of the time you're continuing, not starting over.

### 3. Session list per task

A **dropdown** at the top of SessionPanel showing all sessions for the current task. Shows the current session, click to expand the full list. Compact, no extra sidebars, scales to many sessions.

Each session entry shows:
- **Truncated prompt** as the name (~30 chars of the initial prompt)
- **Status** — active / idle / failed
- **Last activity** — relative timestamp of last message sent or received ("just now", "2h ago", "yesterday")

"New session" option at the bottom of the dropdown.

### 4. Session timestamps

Sessions track `lastActivityAt` — updated whenever a message is sent or received. This powers the "last activity" display in the session list and is the sort key (most recently active first).

### 5. Session naming

Start with **truncated first prompt** as the session name. Good enough for MVP. Future: Claude auto-generates a short name after the first turn (via haiku), user can edit.

### 6. Concurrent session limits

- **10 active sessions globally** (across all tasks) — hard cap, prevent launching more
- **Warning at 5** — "You have 5 sessions running, consider waiting for some to finish"
- "Active" means a turn is in progress (a running SDK process). Idle sessions don't count — they're just database records.

### 7. Task switching

Switching tasks in the sidebar loads that task's most recent session. If the previous task's session was mid-turn (active), it **keeps running in the background**. Sessions are independent — navigating away doesn't interrupt them.

### 8. Page refresh behavior

Session list loads from Convex (persistent). The active session reconnects via WebSocket + replays stored events from Convex. This mostly works already with the Phase 2 infrastructure.

### 9. Stop action

Stop kills an active turn — the SDK process terminates, session status becomes idle (still resumable). This is already implemented; no change needed beyond ensuring the session stays resumable after stop.

### 10. Multiple active sessions per task

Allowed. You can have two sessions running on the same task simultaneously (e.g., one implementing, one writing tests). Each is an independent SDK process. The dropdown shows both with their respective statuses.

### 11. Kanban card session indicators

Task cards on the kanban board show a small dot indicating session state:
- **Green** — at least one active session on this task
- **Gray** — idle sessions exist, none active
- No dot — no sessions

Powered by Convex reactivity (query session status per task). Lets you scan the board and know which tasks have running sessions without opening them.

### 12. Non-visible session status via Convex reactivity

The session dropdown for the current task updates via `useQuery(api.sessions.listByTask)` — no extra WebSocket connections for non-visible sessions. When a background session's status changes (e.g., running → idle), the Convex query updates automatically. To surface "waiting for approval" state in the dropdown, the backend writes `pendingApprovals` count to the session record in Convex when permission events fire.

## Schema Changes

On the `sessions` table, add:

```
lastActivityAt: v.number()    // updated on every message sent/received, powers session list sort
name: v.optional(v.string())  // future: editable session name, for now unused (truncated prompt used instead)
```

New query needed: `sessions.listByTask(taskId)` — returns ALL sessions for a task, ordered by `lastActivityAt` descending. The existing `sessions.getByTask` (returns only the latest) remains for convenience.

## Zustand Store Changes

Replace single `sessionId` with:

```typescript
activeSessionId: string | null   // which session is displayed (replaces sessionId)

// Actions:
openSession(sessionId: string): void    // set active + switch to task-page view (existing behavior, renamed)
switchSession(sessionId: string): void  // change which session is displayed (from dropdown)
closeSession(): void                    // clear active session (existing)
```

Simpler than the Phase 3 proposal — no `openSessions[]` array, no `sessionStates` map, no notification preferences. The dropdown reads directly from the Convex `listByTask` query.

## UI Changes

**SessionPanel header** gains a dropdown selector:
- Shows current session name (truncated prompt) + status badge
- Expands to show all sessions for the task
- Each entry: name, status, last activity timestamp
- "New session" at the bottom

**SessionPanel input box** resumes the active session by default. The backend detects the session has a `sdkSessionId` and uses resume instead of starting fresh.

**TaskPageView** — no structural changes. The dropdown lives within SessionPanel's header area. TaskDetailContent (left panel) is unchanged.

## Future Ideas (Not MVP)

### Chain Tasks
Task A completes → auto-starts Task B → Task C. Linked list via `task.nextTaskId`. Sequential pipeline: "implement feature" → "write tests" → "fix lint". UI: "Then run..." field or drag-connecting tasks.

### Agent Sessions
Two modes: **Interactive** (current, approve tools) and **Agent** (fire-and-forget, full-auto, check results later). Agent = `permissionMode: 'bypass'` with no interaction. Still resumable afterward for follow-up questions.

### Preset Agents & Teams
Preconfigured agent roles (implementer, reviewer, tester). Per-task toggles. Preconfigured team compositions.

### Repo Assistant
A session not tied to a task — general-purpose assistant for the repo. Can create tasks, answer codebase questions, triage issues.

### Attention & Notifications
Badges (green/amber/gray/checkmark/red), toast notifications, browser Notification API. Deferred until multi-session usage patterns are clearer from dogfooding.

### Cost Tracking
Per-session and per-task cost from SDK `result` event. `costUsd` and `tokenUsage` fields on sessions schema.

### Auto-Status Transitions
Session starts → task moves to `in_progress`. Session completes → task moves to `review`. Forward-only, manual override respected.

### Session Auto-Naming
After first turn, ask haiku to generate a 3-5 word session name from the conversation. Replace the truncated prompt placeholder.

### User-Editable Session Names
Click to rename a session in the dropdown. Stored in `sessions.name` field.

### Custom Permission Profiles
Beyond the three presets (Interactive / Safe Auto / Full Auto), let users define custom profiles with fine-grained tool allowlists. Phase 1 already implements the core mechanism: `SAFE_BASH_PATTERNS` (regex allowlist) and `SAFE_TOOLS` (set of always-approved tool names) in `manager.ts`. A custom profile would expose these as user-configurable lists rather than hardcoded constants.

### Per-Repo Defaults
Store default preferences on the repo record in Convex: `defaultModel`, `defaultPermissionProfile`, `autoStatusTransitions`. These apply to all tasks in the repo unless overridden at launch time. The launch UI pre-selects repo defaults so you can launch with a single click for the common case.

## What This Replaces

This doc supersedes Phase 3 (Multi-Session UX) and Phase 4 (Workflow Integration) as the direction for session work. Features from those phases are either absorbed into MVP above or listed in Future Ideas. Phase 3 and 4 docs remain as historical reference — their "Findings" sections document implementation details still relevant.
