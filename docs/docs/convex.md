---
sidebar_position: 5
title: Convex Schema & Functions
---

# Convex Schema & Functions

Holophyte uses [Convex](https://convex.dev) as its real-time database. The schema is defined in `convex/schema.ts` and all functions use object-style definitions with validated `args`.

## Schema Overview

### organizations

Multi-tenant organizations. Each user gets a personal org on signup.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name |
| `slug` | `string` | URL-friendly identifier |
| `personal` | `boolean` | Whether this is a per-user personal org |

**Indexes:** `by_slug`

### memberships

Maps users to organizations with role-based permissions.

| Field | Type | Description |
|-------|------|-------------|
| `userId` | `Id<'users'>` | The user |
| `orgId` | `Id<'organizations'>` | The organization |
| `role` | `'owner' \| 'admin' \| 'member' \| 'viewer'` | Permission level |

**Indexes:** `by_user`, `by_org`, `by_user_org`

### repos

Git repositories linked to an organization by absolute filesystem path.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name |
| `path` | `string` | Absolute path on the companion's machine |
| `createdAt` | `number` | Unix ms timestamp |
| `orgId` | `Id<'organizations'>` | Owning organization |

**Indexes:** `by_path` (uniqueness check), `by_org`

### tasks

Kanban tasks with status-based columns, position ordering, and time tracking.

| Field | Type | Description |
|-------|------|-------------|
| `repoId` | `Id<'repos'>` | Parent repo |
| `title` | `string` | Task title |
| `description` | `string` | Markdown description |
| `prompt` | `string` | Prompt sent to Claude Code sessions |
| `status` | `TaskStatus` | Kanban column (`backlog`, `todo`, `in_progress`, `review`, `done`, `archived`) |
| `position` | `number` | Sort order within the status column |
| `createdAt` | `number` | Unix ms timestamp |
| `updatedAt` | `number` | Unix ms timestamp, bumped on any change |
| `labelIds` | `Id<'labels'>[]?` | Labels applied to this task |
| `dueAt` | `number?` | Due date as Unix ms |
| `inProgressSince` | `number?` | When the task last entered `in_progress` |
| `totalInProgressMs` | `number?` | Accumulated ms spent in `in_progress` across all entries |
| `priority` | `TaskPriority?` | `none`, `low`, `medium`, `high`, `urgent` |
| `archivedAt` | `number?` | When the task was archived |
| `promptHistoryCount` | `number?` | Denormalized count of prompt history entries |
| `createdBy` | `Id<'users'>` | User who created the task |
| `private` | `boolean?` | If true, only visible to the creator |

**Indexes:** `by_repo_status` (main query path), `by_status`

### labels

Color-coded labels for task categorization. Org-scoped with optional user ownership for personal labels.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Label text |
| `color` | `string` | Hex color code |
| `createdAt` | `number` | Unix ms timestamp |
| `orgId` | `Id<'organizations'>` | Owning org |
| `userId` | `Id<'users'>?` | If set, this is a personal label |

**Indexes:** `by_org`, `by_user`

### subtasks

Checklist items within a task.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `Id<'tasks'>` | Parent task |
| `title` | `string` | Subtask text |
| `completed` | `boolean` | Whether checked off |
| `position` | `number` | Sort order |
| `createdAt` | `number` | Unix ms timestamp |

**Index:** `by_task`

### seeds

Lightweight task ideas that can be "planted" into full tasks.

| Field | Type | Description |
|-------|------|-------------|
| `title` | `string` | Seed title |
| `description` | `string` | Details |
| `status` | `'active' \| 'planted'` | Whether this seed has been converted |
| `plantedToTaskId` | `Id<'tasks'>?` | The task created from this seed |
| `createdAt` | `number` | Unix ms timestamp |
| `orgId` | `Id<'organizations'>` | Owning org |

**Indexes:** `by_status`, `by_org`

### promptTemplates

Reusable prompt templates scoped to a repo or global.

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Template name |
| `content` | `string` | Template content |
| `repoId` | `Id<'repos'>?` | Null = global template |
| `createdAt` | `number` | Unix ms timestamp |
| `updatedAt` | `number` | Unix ms timestamp |
| `userId` | `Id<'users'>` | Creator |

**Index:** `by_repo`

### promptHistory

Audit trail of prompt changes per task, recorded automatically on task update.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `Id<'tasks'>` | Parent task |
| `prompt` | `string` | The prompt text at that point in time |
| `createdAt` | `number` | Unix ms timestamp |

**Index:** `by_task` (compound with `createdAt`)

### sessions

Claude Code SDK session records. See the [Sessions](/sessions) page for lifecycle details.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `Id<'tasks'>` | Owning task |
| `status` | `'queued' \| 'running' \| 'idle' \| 'stopped' \| 'failed'` | Lifecycle state |
| `startedAt` | `number` | Unix ms when created |
| `lastActivityAt` | `number?` | Last message sent or received; sort key |
| `name` | `string?` | Auto-generated from first 30 chars of prompt |
| `sdkSessionId` | `string?` | Opaque SDK ID for resume |
| `model` | `string?` | Claude model used |
| `permissionMode` | `string?` | `default`, `safe-auto`, or `bypass` |
| `queuedPrompt` | `string?` | Prompt stored when `status='queued'` |
| `endedAt` | `number?` | When the session completed or failed |
| `lastHeartbeat` | `number?` | Companion heartbeat for liveness |

**Indexes:** `by_task`, `by_status`, `by_task_activity`

### sessionMessages

Follow-up messages from the user, consumed by the companion.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `Id<'sessions'>` | Target session |
| `text` | `string` | Message content |
| `consumed` | `boolean` | Whether the companion has delivered it |
| `createdAt` | `number` | Unix ms timestamp |

**Index:** `by_session_pending` (compound `sessionId` + `consumed`)

### pendingApprovals

Tool-use approval requests created by the companion, resolved by the frontend.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `Id<'sessions'>` | Owning session |
| `requestId` | `string` | SDK tool use ID |
| `tool` | `string` | Tool name (e.g., `Bash`, `Edit`) |
| `input` | `string` | JSON-serialized tool input |
| `resolved` | `boolean` | Whether the user has responded |
| `approved` | `boolean?` | User's decision (set when resolved) |
| `denyMessage` | `string?` | Reason for denial |
| `consumed` | `boolean` | Whether the companion has picked up the response |

**Indexes:** `by_session`, `by_session_unresolved`

### sessionEvents

Batched SDK event log for session replay.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `Id<'sessions'>` | Owning session |
| `events` | `Array<{ type, data, timestamp }>` | Batch of JSON-serialized SDK messages |
| `batchIndex` | `number` | Sequence number for ordering |

**Index:** `by_session_batch` (compound `sessionId` + `batchIndex`)

### companion

Companion server heartbeat for status display and duplicate detection.

| Field | Type | Description |
|-------|------|-------------|
| `orgId` | `Id<'organizations'>` | Which org this heartbeat is for |
| `lastSeen` | `number` | Unix ms of last heartbeat |
| `activeSessionCount` | `number` | Running sessions on this companion |
| `machineId` | `string?` | Hostname or custom identifier |
| `url` | `string?` | Companion's localhost URL |

**Indexes:** `by_org`, `by_org_machine` (uniqueness), `by_org_last_seen` (sorted)

---

## Function Reference

### Authorization Patterns

All public queries and mutations use two auth helpers from `convex/lib/auth.ts`:

- **`requireAuth(ctx)`** — returns the authenticated `userId` or throws `"Not authenticated"`
- **`requireOrgMembership(ctx, orgId)`** — returns `{ userId, membership }` or throws `"Not a member of this organization"`
- **`requireRole(membership, minRole)`** — throws if the membership role is below the minimum (`viewer` < `member` < `admin` < `owner`)

Internal functions (prefixed `server*` or `companion*`) use `INTERNAL_API_SECRET` validation instead.

### repos.ts

| Function | Type | Min Role | Description |
|----------|------|----------|-------------|
| `list` | Query | member | List all repos in an org |
| `get` | Query | member | Get a single repo by ID |
| `create` | Mutation | member | Create a repo (unique path enforced) |
| `update` | Mutation | member | Rename a repo |
| `remove` | Mutation | admin | Delete repo with cascade (tasks → sessions, subtasks, history, templates) |

### tasks.ts

| Function | Type | Min Role | Description |
|----------|------|----------|-------------|
| `listByRepo` | Query | member | Tasks for a repo (excludes archived by default, filters private) |
| `listAll` | Query | member | Tasks across all org repos |
| `listArchived` | Query | member | Archived tasks, optionally per-repo, sorted by archive date |
| `listActive` | Query | member | In-progress and review tasks with running session indicator |
| `get` | Query | member | Single task with repo, labels, subtask counts |
| `create` | Mutation | member | Create task at end of target column |
| `update` | Mutation | member | Update fields, record prompt history on change |
| `move` | Mutation | member | Change status/position with time tracking |
| `reorder` | Mutation | member | Reorder within same column |
| `unarchive` | Mutation | member | Restore archived task to Done |
| `archiveAllDone` | Mutation | member | Archive all Done tasks in a repo |
| `remove` | Mutation | admin | Delete task with cascade |
| `bulkMove` | Mutation | member | Move multiple tasks to a status |
| `bulkDelete` | Mutation | admin | Delete multiple tasks with cascade |
| `bulkToggleLabel` | Mutation | member | Add/remove a label from multiple tasks |

### sessions.ts

**Public functions:**

| Function | Type | Min Role | Description |
|----------|------|----------|-------------|
| `listActive` | Query | member | Running sessions for an org |
| `get` | Query | member | Single session by ID |
| `getByTask` | Query | member | Most recent session for a task |
| `listByTask` | Query | member | All sessions for a task (newest first) |
| `create` | Mutation | member | Create a `queued` session with prompt |
| `updateStatus` | Mutation | member | Transition session status |
| `resumeSession` | Mutation | member | Atomically idle → running |
| `requestStop` | Mutation | member | Set status to `stopped` |
| `queueResume` | Mutation | member | Re-queue idle session with new prompt |
| `updateLastActivity` | Mutation | member | Bump `lastActivityAt` |

**Internal functions** (companion use only):

| Function | Type | Description |
|----------|------|-------------|
| `countActive` | InternalQuery | Global running session count (concurrent cap) |
| `updateSdkSessionId` | InternalMutation | Store SDK session ID after init |
| `serverUpdateStatus` | InternalMutation | Update status (no auth) |
| `serverUpdateActivity` | InternalMutation | Bump activity timestamp |
| `serverMarkStoppedAsIdle` | InternalMutation | Crash recovery: stopped → idle |
| `serverMarkStaleRunning` | InternalMutation | Crash recovery: running → idle |
| `serverUpdateName` | InternalMutation | Set auto-generated name |
| `listQueued` | InternalQuery | Queued sessions with repo paths |
| `claimQueued` | InternalMutation | Atomically claim a queued session |
| `reapStaleSessions` | InternalMutation | Timeout queued/stopped sessions (cron) |
| `serverBatchHeartbeat` | InternalMutation | Update heartbeats for active sessions |
| `listStopped` | InternalQuery | Sessions with `stopped` status |
| `companionListQueued` | Query | Queued sessions for reactive subscriptions (token auth) |
| `companionListStopped` | Query | Stopped sessions for reactive subscriptions (token auth) |

### pendingApprovals.ts

| Function | Type | Visibility | Description |
|----------|------|------------|-------------|
| `getBySession` | Query | Public | All approvals for a session |
| `resolve` | Mutation | Public | Approve or deny a tool request |
| `serverCreate` | InternalMutation | Internal | Create approval from SDK event |
| `serverListResolvedUnconsumed` | InternalQuery | Internal | Poll for user responses |
| `serverMarkConsumed` | InternalMutation | Internal | Mark approval as consumed |
| `serverDenyAll` | InternalMutation | Internal | Deny all pending on session stop |

### sessionMessages.ts

| Function | Type | Visibility | Description |
|----------|------|------------|-------------|
| `send` | Mutation | Public | Send a follow-up message (member) |
| `listPending` | InternalQuery | Internal | Unconsumed messages for polling |
| `markConsumed` | InternalMutation | Internal | Mark as delivered |
| `companionListPending` | Query | Public | Unconsumed messages for subscriptions (token auth) |

### sessionEvents.ts

| Function | Type | Visibility | Description |
|----------|------|------------|-------------|
| `getBySession` | Query | Public | All event batches for a session, ordered by `batchIndex` |
| `insertBatch` | InternalMutation | Internal | Persist a batch of SDK events |
| `getNextBatchIndex` | InternalQuery | Internal | Next batch sequence number |

### Other modules

| Module | Key Functions |
|--------|--------------|
| `organizations.ts` | `listByUser`, `get`, `create`, `createPersonal` (internal), `update`, `remove` (cascade), `getDefaultOrg` (internal) |
| `labels.ts` | `list`, `create`, `update`, `remove` (cascade from tasks) |
| `subtasks.ts` | `listByTask`, `countsByTasks`, `create`, `toggle`, `updateTitle`, `remove` |
| `seeds.ts` | `list`, `create`, `update`, `remove`, `plant` (convert to task) |
| `promptTemplates.ts` | `list`, `create`, `update`, `remove` |
| `promptHistory.ts` | `listByTask`, `record` (deduplicates) |
| `companion.ts` | `upsertHeartbeat` (internal), `upsertHeartbeatAllOrgs` (internal), `getLastSeen` (internal), `getStatus` (public) |

---

## Cascade Deletion

Deleting a parent entity cascades manually (no foreign key constraints in Convex):

```
organization.remove
  ├── repos → tasks → sessions, subtasks, promptHistory
  ├── labels
  ├── seeds
  └── memberships

repos.remove
  └── tasks → sessions, subtasks, promptHistory
  └── promptTemplates

tasks.remove
  ├── sessions
  ├── subtasks
  └── promptHistory
```

## Timestamps

All timestamps are stored as `v.number()` using `Date.now()` (Unix milliseconds). Common patterns:
- `createdAt` — set on insert, never modified
- `updatedAt` — bumped on every mutation
- `lastActivityAt` — bumped on messages/events, used as sort key
- `lastSeen` / `lastHeartbeat` — companion liveness signals
