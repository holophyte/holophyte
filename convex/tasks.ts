import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { priorityValidator, TaskStatus, taskStatusValidator } from './schema';

export const listByRepo = query({
  args: { repoId: v.id('repos'), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) => q.eq('repoId', args.repoId))
      .collect();
    if (args.includeArchived) return tasks;
    return tasks.filter((t) => t.status !== TaskStatus.Archived);
  },
});

export const listAll = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tasks = await ctx.db.query('tasks').collect();
    if (args.includeArchived) return tasks;
    return tasks.filter((t) => t.status !== TaskStatus.Archived);
  },
});

export const listArchived = query({
  args: { repoId: v.optional(v.id('repos')) },
  handler: async (ctx, args) => {
    const tasks = args.repoId
      ? await ctx.db
          .query('tasks')
          .withIndex('by_repo_status', (q) =>
            q.eq('repoId', args.repoId!).eq('status', TaskStatus.Archived),
          )
          .collect()
      : await ctx.db
          .query('tasks')
          .withIndex('by_status', (q) => q.eq('status', TaskStatus.Archived))
          .collect();
    return tasks.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  },
});

export const get = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);

    // Fetch labels
    const labels = [];
    for (const labelId of task.labelIds ?? []) {
      const label = await ctx.db.get(labelId);
      if (label) labels.push(label);
    }

    // Fetch subtask counts
    const subtasks = await ctx.db
      .query('subtasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.id))
      .collect();
    const subtaskTotal = subtasks.length;
    const subtaskCompleted = subtasks.filter((s) => s.completed).length;

    return { ...task, repo, labels, subtaskTotal, subtaskCompleted };
  },
});

export const create = mutation({
  args: {
    repoId: v.id('repos'),
    title: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    labelIds: v.optional(v.array(v.id('labels'))),
    dueAt: v.optional(v.number()),
    status: v.optional(taskStatusValidator),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    const targetStatus = args.status ?? TaskStatus.Backlog;
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', args.repoId).eq('status', targetStatus),
      )
      .collect();
    const maxPosition = existing.reduce(
      (max, t) => Math.max(max, t.position),
      0,
    );
    const now = Date.now();
    return await ctx.db.insert('tasks', {
      repoId: args.repoId,
      title: args.title,
      description: args.description ?? '',
      prompt: args.prompt ?? '',
      status: targetStatus,
      position: maxPosition + 1,
      createdAt: now,
      updatedAt: now,
      labelIds: args.labelIds,
      dueAt: args.dueAt,
      priority: args.priority,
      totalInProgressMs: 0,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('tasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    labelIds: v.optional(v.array(v.id('labels'))),
    dueAt: v.optional(v.number()),
    clearDueAt: v.optional(v.boolean()),
    priority: v.optional(priorityValidator),
  },
  handler: async (ctx, args) => {
    const { id, clearDueAt, ...fields } = args;
    const updates: Record<string, unknown> = { updatedAt: Date.now() };
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined)
      updates.description = fields.description;
    if (fields.prompt !== undefined) updates.prompt = fields.prompt;
    if (fields.labelIds !== undefined) updates.labelIds = fields.labelIds;
    if (fields.dueAt !== undefined) updates.dueAt = fields.dueAt;
    if (clearDueAt) updates.dueAt = undefined;
    if (fields.priority !== undefined) updates.priority = fields.priority;
    await ctx.db.patch(id, updates);
  },
});

export const move = mutation({
  args: {
    id: v.id('tasks'),
    status: taskStatusValidator,
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error('Task not found');

    const now = Date.now();
    const updates: Record<string, unknown> = {
      status: args.status,
      position: args.position,
      updatedAt: now,
    };

    // Time tracking: leaving in_progress
    if (
      task.status === TaskStatus.InProgress &&
      args.status !== TaskStatus.InProgress
    ) {
      const elapsed = task.inProgressSince ? now - task.inProgressSince : 0;
      updates.totalInProgressMs = (task.totalInProgressMs ?? 0) + elapsed;
      updates.inProgressSince = undefined;
    }

    // Time tracking: entering in_progress
    if (
      task.status !== TaskStatus.InProgress &&
      args.status === TaskStatus.InProgress
    ) {
      updates.inProgressSince = now;
    }

    // Archive timestamp
    if (args.status === TaskStatus.Archived) {
      updates.archivedAt = now;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const reorder = mutation({
  args: {
    id: v.id('tasks'),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      position: args.position,
      updatedAt: Date.now(),
    });
  },
});

export const unarchive = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.status !== TaskStatus.Archived) return;
    const doneTasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', task.repoId).eq('status', TaskStatus.Done),
      )
      .collect();
    const maxPosition = doneTasks.reduce(
      (max, t) => Math.max(max, t.position),
      0,
    );
    await ctx.db.patch(args.id, {
      status: TaskStatus.Done,
      position: maxPosition + 1,
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const archiveAllDone = mutation({
  args: { repoId: v.id('repos') },
  handler: async (ctx, args) => {
    const doneTasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', args.repoId).eq('status', TaskStatus.Done),
      )
      .collect();
    const now = Date.now();
    for (const task of doneTasks) {
      await ctx.db.patch(task._id, {
        status: TaskStatus.Archived,
        archivedAt: now,
        updatedAt: now,
      });
    }
  },
});

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const inProgress = await ctx.db
      .query('tasks')
      .withIndex('by_status', (q) => q.eq('status', TaskStatus.InProgress))
      .collect();
    const inReview = await ctx.db
      .query('tasks')
      .withIndex('by_status', (q) => q.eq('status', TaskStatus.Review))
      .collect();
    const tasks = [...inProgress, ...inReview];
    return Promise.all(
      tasks.map(async (t) => {
        const repo = await ctx.db.get(t.repoId);
        const sessions = await ctx.db
          .query('sessions')
          .withIndex('by_task', (q) => q.eq('taskId', t._id))
          .collect();
        const hasRunningSession = sessions.some((s) => s.status === 'running');
        return { ...t, repoName: repo?.name, hasRunningSession };
      }),
    );
  },
});

export const remove = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    // Delete sessions
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_task', (q) => q.eq('taskId', args.id))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    // Delete subtasks
    const subtasks = await ctx.db
      .query('subtasks')
      .withIndex('by_task', (q) => q.eq('taskId', args.id))
      .collect();
    for (const subtask of subtasks) {
      await ctx.db.delete(subtask._id);
    }
    await ctx.db.delete(args.id);
  },
});

export const bulkMove = mutation({
  args: {
    ids: v.array(v.id('tasks')),
    status: taskStatusValidator,
  },
  handler: async (ctx, args) => {
    // Find max position in the target column to append after
    const existing = await ctx.db
      .query('tasks')
      .withIndex('by_status', (q) => q.eq('status', args.status))
      .collect();
    let maxPosition = existing.reduce((max, t) => Math.max(max, t.position), 0);

    const now = Date.now();
    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;
      if (task.status === args.status) continue;

      maxPosition += 1;
      const updates: Record<string, unknown> = {
        status: args.status,
        position: maxPosition,
        updatedAt: now,
      };

      // Time tracking: leaving in_progress
      if (
        task.status === TaskStatus.InProgress &&
        args.status !== TaskStatus.InProgress
      ) {
        const elapsed = task.inProgressSince ? now - task.inProgressSince : 0;
        updates.totalInProgressMs = (task.totalInProgressMs ?? 0) + elapsed;
        updates.inProgressSince = undefined;
      }

      // Time tracking: entering in_progress
      if (
        task.status !== TaskStatus.InProgress &&
        args.status === TaskStatus.InProgress
      ) {
        updates.inProgressSince = now;
      }

      // Archive timestamp
      if (args.status === TaskStatus.Archived) {
        updates.archivedAt = now;
      }

      await ctx.db.patch(id, updates);
    }
  },
});

export const bulkDelete = mutation({
  args: { ids: v.array(v.id('tasks')) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;
      // Delete sessions
      const sessions = await ctx.db
        .query('sessions')
        .withIndex('by_task', (q) => q.eq('taskId', id))
        .collect();
      for (const session of sessions) {
        await ctx.db.delete(session._id);
      }
      // Delete subtasks
      const subtasks = await ctx.db
        .query('subtasks')
        .withIndex('by_task', (q) => q.eq('taskId', id))
        .collect();
      for (const subtask of subtasks) {
        await ctx.db.delete(subtask._id);
      }
      await ctx.db.delete(id);
    }
  },
});

export const bulkUpdateLabels = mutation({
  args: {
    ids: v.array(v.id('tasks')),
    labelIds: v.array(v.id('labels')),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;
      await ctx.db.patch(id, {
        labelIds: args.labelIds,
        updatedAt: now,
      });
    }
  },
});
