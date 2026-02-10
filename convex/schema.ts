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

export const taskStatusValidator = v.union(
  v.literal(TaskStatus.Backlog),
  v.literal(TaskStatus.Todo),
  v.literal(TaskStatus.InProgress),
  v.literal(TaskStatus.Review),
  v.literal(TaskStatus.Done),
  v.literal(TaskStatus.Archived),
);

export default defineSchema({
  repos: defineTable({
    name: v.string(),
    path: v.string(),
    createdAt: v.number(),
  }).index('by_path', ['path']),

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
    // Archive timestamp
    archivedAt: v.optional(v.number()),
  })
    .index('by_repo_status', ['repoId', 'status'])
    .index('by_status', ['status']),

  labels: defineTable({
    name: v.string(),
    color: v.string(),
    createdAt: v.number(),
  }),

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
  }).index('by_status', ['status']),

  sessions: defineTable({
    taskId: v.id('tasks'),
    status: v.union(
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('stopped'),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index('by_task', ['taskId'])
    .index('by_status', ['status']),
});
