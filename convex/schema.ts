import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export enum TaskStatus {
  Backlog = 'backlog',
  Todo = 'todo',
  InProgress = 'in_progress',
  Review = 'review',
  Done = 'done',
  Archived = 'archived',
}

export const TASK_STATUSES = Object.values(TaskStatus);

export const taskStatusValidator = v.union(
  v.literal(TaskStatus.Backlog),
  v.literal(TaskStatus.Todo),
  v.literal(TaskStatus.InProgress),
  v.literal(TaskStatus.Review),
  v.literal(TaskStatus.Done),
  v.literal(TaskStatus.Archived),
);

export const sessionStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('idle'),
  v.literal('stopped'),
  v.literal('failed'),
);

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

export const roleValidator = v.union(
  v.literal('owner'),
  v.literal('admin'),
  v.literal('member'),
  v.literal('viewer'),
);

export default defineSchema({
  ...authTables,

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    personal: v.boolean(),
  }).index('by_slug', ['slug']),

  memberships: defineTable({
    userId: v.id('users'),
    orgId: v.id('organizations'),
    role: roleValidator,
  })
    .index('by_user', ['userId'])
    .index('by_org', ['orgId'])
    .index('by_user_org', ['userId', 'orgId']),

  repos: defineTable({
    name: v.string(),
    path: v.string(),
    createdAt: v.number(),
    orgId: v.id('organizations'),
  })
    .index('by_path', ['path'])
    .index('by_org', ['orgId']),

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

  labels: defineTable({
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
    orgId: v.id('organizations'),
    userId: v.optional(v.id('users')),
  })
    .index('by_org', ['orgId'])
    .index('by_user', ['userId']),

  subtasks: defineTable({
    taskId: v.id('tasks'),
    title: v.string(),
    completed: v.boolean(),
    position: v.number(),
    createdAt: v.number(),
  }).index('by_task', ['taskId']),

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

  promptTemplates: defineTable({
    name: v.string(),
    content: v.string(),
    // null repoId = global template
    repoId: v.optional(v.id('repos')),
    createdAt: v.number(),
    updatedAt: v.number(),
    userId: v.id('users'),
  }).index('by_repo', ['repoId']),

  promptHistory: defineTable({
    taskId: v.id('tasks'),
    prompt: v.string(),
    createdAt: v.number(),
  }).index('by_task', ['taskId', 'createdAt']),

  sessions: defineTable({
    taskId: v.id('tasks'),
    orgId: v.optional(v.id('organizations')), // logically required; optional for backwards-compat during backfill
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
    // Commands and skills — accepts both old string[] and new {name, description}[] format
    projectCommands: v.optional(
      v.array(
        v.union(
          v.string(),
          v.object({ name: v.string(), description: v.string() }),
        ),
      ),
    ),
  })
    .index('by_task', ['taskId'])
    .index('by_status', ['status'])
    .index('by_task_activity', ['taskId', 'lastActivityAt'])
    .index('by_org_status', ['orgId', 'status']),

  sessionMessages: defineTable({
    sessionId: v.id('sessions'),
    text: v.string(),
    consumed: v.boolean(),
    createdAt: v.number(),
  }).index('by_session_pending', ['sessionId', 'consumed']),

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

  apiKeys: defineTable({
    userId: v.id('users'),
    hashedKey: v.string(),
    name: v.string(),
    // Only valid scope for now is 'mcp' — extensible in the future
    scopes: v.array(v.string()),
    // NO createdAt — use _creationTime
    expiresAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_user', ['userId'])
    .index('by_hashed_key', ['hashedKey']),

  companion: defineTable({
    orgId: v.id('organizations'),
    lastSeen: v.number(),
    activeSessionCount: v.number(),
    machineId: v.optional(v.string()),
    instanceId: v.optional(v.string()), // required — added to existing table
    url: v.optional(v.string()),
  })
    .index('by_org', ['orgId'])
    .index('by_org_machine', ['orgId', 'machineId']) // kept for rollback path
    .index('by_org_instance', ['orgId', 'instanceId'])
    .index('by_org_last_seen', ['orgId', 'lastSeen']),
});
