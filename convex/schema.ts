import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

/** Kanban column statuses that a task progresses through. */
export enum TaskStatus {
  /** Unplanned — hidden by default in the backlog drawer. */
  Backlog = 'backlog',
  /** Planned but not yet started. */
  Todo = 'todo',
  /** Actively being worked on — triggers time tracking. */
  InProgress = 'in_progress',
  /** Work complete, awaiting review. */
  Review = 'review',
  /** Finished. Can be bulk-archived. */
  Done = 'done',
  /** Soft-deleted — excluded from board unless explicitly shown. */
  Archived = 'archived',
}

/** All task status values as an array, useful for iteration. */
export const TASK_STATUSES = Object.values(TaskStatus);

/** Convex validator for task status fields — matches {@link TaskStatus} enum values. */
export const taskStatusValidator = v.union(
  v.literal(TaskStatus.Backlog),
  v.literal(TaskStatus.Todo),
  v.literal(TaskStatus.InProgress),
  v.literal(TaskStatus.Review),
  v.literal(TaskStatus.Done),
  v.literal(TaskStatus.Archived),
);

/**
 * Convex validator for session lifecycle states.
 * - `queued`: waiting for companion to pick up
 * - `running`: Claude Agent SDK process active
 * - `idle`: SDK process ended normally, can be resumed
 * - `stopped`: user requested stop, companion will terminate the process
 * - `failed`: SDK process crashed or timed out
 */
export const sessionStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('idle'),
  v.literal('stopped'),
  v.literal('failed'),
);

/** Priority levels for task ordering and visual indicators. */
export enum TaskPriority {
  None = 'none',
  Low = 'low',
  Medium = 'medium',
  High = 'high',
  Urgent = 'urgent',
}

export const priorityValidator = v.union(
  v.literal(TaskPriority.None),
  v.literal(TaskPriority.Low),
  v.literal(TaskPriority.Medium),
  v.literal(TaskPriority.High),
  v.literal(TaskPriority.Urgent),
);

/** Display label and color for each priority level, used by the frontend badge. */
export const PRIORITY_CONFIG: Record<
  TaskPriority,
  { label: string; color: string }
> = {
  [TaskPriority.None]: { label: 'None', color: '' },
  [TaskPriority.Low]: { label: 'Low', color: '#3b82f6' },
  [TaskPriority.Medium]: { label: 'Medium', color: '#eab308' },
  [TaskPriority.High]: { label: 'High', color: '#f97316' },
  [TaskPriority.Urgent]: { label: 'Urgent', color: '#ef4444' },
};

/**
 * Organization membership roles (descending privilege).
 * - `owner`: full control, cannot be removed
 * - `admin`: can delete repos/tasks, manage members
 * - `member`: can create/edit tasks and sessions
 * - `viewer`: read-only access
 */
export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('viewer'),
);

export default defineSchema({
  ...authTables,

  /** Multi-tenant organizations. Each user gets a personal org on signup. */
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    personal: v.boolean(),
  }).index('by_slug', ['slug']),

  /** Maps users to organizations with a role-based permission level. */
  memberships: defineTable({
    userId: v.id('users'),
    orgId: v.id('organizations'),
    role: roleValidator,
  })
    .index('by_user', ['userId'])
    .index('by_org', ['orgId'])
    .index('by_user_org', ['userId', 'orgId']),

  /** Git repositories linked to an org. Path is the absolute filesystem path on the companion machine. */
  repos: defineTable({
    name: v.string(),
    path: v.string(),
    createdAt: v.number(),
    orgId: v.id('organizations'),
  })
    .index('by_path', ['path'])
    .index('by_org', ['orgId']),

  /**
   * Kanban tasks belonging to a repo. Each task has a prompt for Claude Code sessions,
   * position-based ordering within its status column, and optional time tracking
   * for the `in_progress` state.
   */
  tasks: defineTable({
    repoId: v.id('repos'),
    title: v.string(),
    description: v.string(),
    prompt: v.string(),
    status: taskStatusValidator,
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Labels (many-to-many via ID array)
    labelIds: v.optional(v.array(v.id('labels'))),
    // Due date (ms timestamp)
    dueAt: v.optional(v.number()),
    // Time tracking: when task last entered in_progress
    inProgressSince: v.optional(v.number()),
    // Time tracking: accumulated ms spent in in_progress
    totalInProgressMs: v.optional(v.number()),
    // Priority
    priority: v.optional(priorityValidator),
    // Archive timestamp
    archivedAt: v.optional(v.number()),
    // Denormalized prompt history count
    promptHistoryCount: v.optional(v.number()),
    // Auth: who created + private flag
    createdBy: v.id('users'),
    private: v.optional(v.boolean()),
  })
    .index('by_repo_status', ['repoId', 'status'])
    .index('by_status', ['status']),

  /** Color-coded labels for categorizing tasks. Org-scoped with optional user ownership. */
  labels: defineTable({
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
    orgId: v.id('organizations'),
    userId: v.optional(v.id('users')),
  })
    .index('by_org', ['orgId'])
    .index('by_user', ['userId']),

  /** Checklist items within a task. Ordered by position, individually completable. */
  subtasks: defineTable({
    taskId: v.id('tasks'),
    title: v.string(),
    completed: v.boolean(),
    position: v.number(),
    createdAt: v.number(),
  }).index('by_task', ['taskId']),

  /** Lightweight task ideas that can be "planted" (converted) into full tasks. */
  seeds: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal('active'), v.literal('planted')),
    plantedToTaskId: v.optional(v.id('tasks')),
    createdAt: v.number(),
    orgId: v.id('organizations'),
  })
    .index('by_status', ['status'])
    .index('by_org', ['orgId']),

  /** Reusable prompt templates. Repo-scoped (or global when `repoId` is null). */
  promptTemplates: defineTable({
    name: v.string(),
    content: v.string(),
    // null repoId = global template
    repoId: v.optional(v.id('repos')),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: v.id('users'),
  }).index('by_repo', ['repoId']),

  /** Audit trail of prompt changes on a task, ordered by creation time. */
  promptHistory: defineTable({
    taskId: v.id('tasks'),
    prompt: v.string(),
    createdAt: v.number(),
  }).index('by_task', ['taskId', 'createdAt']),

  /**
   * Claude Code SDK sessions. Lifecycle: queued → running → idle/failed.
   * The companion picks up queued sessions, spawns SDK processes, and updates
   * status via internal HTTP endpoints. Heartbeats detect stale sessions.
   */
  sessions: defineTable({
    taskId: v.id('tasks'),
    status: v.union(
      v.literal('queued'),
      v.literal('running'),
      v.literal('idle'),
      v.literal('stopped'),
      v.literal('failed'),
    ),
    startedAt: v.number(),
    lastActivityAt: v.optional(v.number()),
    name: v.optional(v.string()),
    sdkSessionId: v.optional(v.string()),
    model: v.optional(v.string()),
    permissionMode: v.optional(v.string()),
    // Stored when status='queued' so the companion can pick it up
    queuedPrompt: v.optional(v.string()),
    // Kept optional for backwards compatibility with pre-rethink documents
    endedAt: v.optional(v.number()),
    // Companion heartbeat — updated every poll cycle for active sessions
    lastHeartbeat: v.optional(v.number()),
  })
    .index('by_task', ['taskId'])
    .index('by_status', ['status'])
    .index('by_task_activity', ['taskId', 'lastActivityAt']),

  /** Follow-up messages sent by the user to a running session, consumed by the companion. */
  sessionMessages: defineTable({
    sessionId: v.id('sessions'),
    text: v.string(),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index('by_session_pending', ['sessionId', 'consumed']),

  /**
   * Tool-use approval requests from the SDK that need user action.
   * Created by the companion, resolved by the frontend, then consumed by the companion.
   */
  pendingApprovals: defineTable({
    sessionId: v.id('sessions'),
    requestId: v.string(),
    tool: v.string(),
    input: v.string(),
    resolved: v.boolean(),
    approved: v.optional(v.boolean()),
    denyMessage: v.optional(v.string()),
    consumed: v.boolean(),
  })
    .index('by_session', ['sessionId'])
    .index('by_session_unresolved', ['sessionId', 'resolved']),

  /**
   * Batched SDK event log for session replay. Events are JSON-serialized SDKMessages
   * stored in ordered batches to avoid per-event document overhead.
   */
  sessionEvents: defineTable({
    sessionId: v.id('sessions'),
    events: v.array(
      v.object({
        type: v.string(),
        data: v.string(), // JSON-serialized SDKMessage
        timestamp: v.number(),
      }),
    ),
    batchIndex: v.number(),
  }).index('by_session_batch', ['sessionId', 'batchIndex']),

  /**
   * Companion server heartbeat record. One per org per machine.
   * Used to detect duplicate instances and show connection status in the UI.
   */
  companion: defineTable({
    orgId: v.id('organizations'),
    lastSeen: v.number(),
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    url: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_machine', ['orgId', 'machineId'])
    .index('by_org_last_seen', ['orgId', 'lastSeen']),
});
