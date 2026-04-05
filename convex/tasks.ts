import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import { requireOrgMembership, requireRole } from './lib/auth';
import { priorityValidator, TaskStatus, taskStatusValidator } from './schema';

/** Filter out private tasks not owned by the current user. */
function filterPrivate(tasks: Doc<'tasks'>[], userId: Id<'users'>) {
  return tasks.filter((t) => !t.private || t.createdBy === userId);
}

/** Throw if the task is private and not owned by the current user. */
function requirePrivateOwnership(task: Doc<'tasks'>, userId: Id<'users'>) {
  if (task.private && task.createdBy !== userId) {
    throw new Error("Cannot modify another user's private task");
  }
}

export const listByRepo = query({
  args: { repoId: v.id('repos'), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) return [];
    const { userId } = await requireOrgMembership(ctx, repo.orgId);
    const tasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) => q.eq('repoId', args.repoId))
      .collect();
    const visible = filterPrivate(tasks, userId);
    if (args.includeArchived) return visible;
    return visible.filter((t) => t.status !== TaskStatus.Archived);
  },
});

export const listAll = query({
  args: {
    orgId: v.id('organizations'),
    includeArchived: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMembership(ctx, args.orgId);
    // Get all repos in org, then collect tasks
    const repos = await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    const allTasks: Doc<'tasks'>[] = [];
    for (const repo of repos) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) => q.eq('repoId', repo._id))
        .collect();
      allTasks.push(...tasks);
    }
    const visible = filterPrivate(allTasks, userId);
    if (args.includeArchived) return visible;
    return visible.filter((t) => t.status !== TaskStatus.Archived);
  },
});

export const listArchived = query({
  args: { repoId: v.optional(v.id('repos')), orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMembership(ctx, args.orgId);
    let tasks: Doc<'tasks'>[];
    if (args.repoId) {
      const repoId = args.repoId;
      const repo = await ctx.db.get(repoId);
      if (!repo || repo.orgId !== args.orgId) return [];
      tasks = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) =>
          q.eq('repoId', repoId).eq('status', TaskStatus.Archived),
        )
        .collect();
    } else {
      // Get archived tasks across all org repos
      const repos = await ctx.db
        .query('repos')
        .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
        .collect();
      tasks = [];
      for (const repo of repos) {
        const repoTasks = await ctx.db
          .query('tasks')
          .withIndex('by_repo_status', (q) =>
            q.eq('repoId', repo._id).eq('status', TaskStatus.Archived),
          )
          .collect();
        tasks.push(...repoTasks);
      }
    }
    return filterPrivate(tasks, userId).sort(
      (a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0),
    );
  },
});

export const get = query({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return null;
    const { userId } = await requireOrgMembership(ctx, repo.orgId);

    // Check private task access
    if (task.private && task.createdBy !== userId) return null;

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
    private: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
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
    const taskId = await ctx.db.insert('tasks', {
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
      createdBy: userId,
      private: args.private,
    });

    return taskId;
  },
});

export const update = mutation({
  args: {
    id: v.id('tasks'),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    position: v.optional(v.number()),
    labelIds: v.optional(v.array(v.id('labels'))),
    dueAt: v.optional(v.number()),
    clearDueAt: v.optional(v.boolean()),
    priority: v.optional(priorityValidator),
    private: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    requirePrivateOwnership(task, userId);
    const { id, clearDueAt, ...fields } = args;
    // Only the task creator can toggle the private flag
    if (fields.private !== undefined && task.createdBy !== userId) {
      throw new Error('Only the task creator can change the private flag');
    }
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined)
      updates.description = fields.description;
    if (fields.prompt !== undefined) updates.prompt = fields.prompt;
    if (fields.position !== undefined) updates.position = fields.position;
    if (fields.labelIds !== undefined) updates.labelIds = fields.labelIds;
    if (fields.dueAt !== undefined) updates.dueAt = fields.dueAt;
    if (clearDueAt) updates.dueAt = undefined;
    if (fields.priority !== undefined) updates.priority = fields.priority;
    if (fields.private !== undefined) updates.private = fields.private;
    await ctx.db.patch(id, updates);

    // Record prompt history when prompt changes (including clears)
    if (fields.prompt !== undefined) {
      const trimmed = fields.prompt.trim();
      const latest = await ctx.db
        .query('promptHistory')
        .withIndex('by_task', (q) => q.eq('taskId', id))
        .order('desc')
        .first();
      if (!latest || latest.prompt !== trimmed) {
        await ctx.db.insert('promptHistory', {
          taskId: id,
          prompt: trimmed,
          createdAt: now,
        });
        await ctx.db.patch(id, {
          promptHistoryCount: (task.promptHistoryCount ?? 0) + 1,
        });
      }
    }
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
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    requirePrivateOwnership(task, userId);

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
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    requirePrivateOwnership(task, userId);
    await ctx.db.patch(args.id, {
      position: args.position,
      updatedAt: Date.now(),
    });
  },
});

export const bulkReorder = mutation({
  args: {
    ids: v.array(v.id('tasks')),
  },
  handler: async (ctx, args) => {
    const firstId = args.ids[0];
    if (!firstId) {
      throw new Error('Task IDs must be non-empty');
    }

    const uniqueIds = new Set(args.ids);
    if (uniqueIds.size !== args.ids.length) {
      throw new Error('Task IDs must be unique');
    }

    const firstTask = await ctx.db.get(firstId);
    if (!firstTask) throw new Error('Task not found');
    const firstRepo = await ctx.db.get(firstTask.repoId);
    if (!firstRepo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(
      ctx,
      firstRepo.orgId,
    );
    requireRole(membership, 'member');

    const selectedTasks = [];
    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) throw new Error('Task not found');
      if (task.repoId !== firstTask.repoId) {
        throw new Error('All tasks must belong to the same repo');
      }
      if (task.status !== firstTask.status) {
        throw new Error('All tasks must have the same status');
      }
      requirePrivateOwnership(task, userId);
      selectedTasks.push(task);
    }

    const columnTasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', firstTask.repoId).eq('status', firstTask.status),
      )
      .collect();

    const specifiedIds = new Set(args.ids);
    const remainingTasks = columnTasks
      .filter((task) => !specifiedIds.has(task._id))
      .sort((a, b) => a.position - b.position);

    const reorderedTasks = [...selectedTasks, ...remainingTasks];
    const now = Date.now();

    for (const [index, task] of reorderedTasks.entries()) {
      if (task.private && task.createdBy !== userId) continue;
      await ctx.db.patch(task._id, {
        position: index + 1,
        updatedAt: now,
      });
    }
  },
});

export const unarchive = mutation({
  args: { id: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.status !== TaskStatus.Archived) return;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return;
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    requirePrivateOwnership(task, userId);
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
    const repo = await ctx.db.get(args.repoId);
    if (!repo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    const doneTasks = await ctx.db
      .query('tasks')
      .withIndex('by_repo_status', (q) =>
        q.eq('repoId', args.repoId).eq('status', TaskStatus.Done),
      )
      .collect();
    const now = Date.now();
    for (const task of doneTasks) {
      if (task.private && task.createdBy !== userId) continue;
      await ctx.db.patch(task._id, {
        status: TaskStatus.Archived,
        archivedAt: now,
        updatedAt: now,
      });
    }
  },
});

export const listActive = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    const { userId } = await requireOrgMembership(ctx, args.orgId);
    const repos = await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', args.orgId))
      .collect();
    // Collect in_progress and review tasks from org repos
    const allTasks: Doc<'tasks'>[] = [];
    for (const repo of repos) {
      const inProgress = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) =>
          q.eq('repoId', repo._id).eq('status', TaskStatus.InProgress),
        )
        .collect();
      const inReview = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) =>
          q.eq('repoId', repo._id).eq('status', TaskStatus.Review),
        )
        .collect();
      allTasks.push(...inProgress, ...inReview);
    }

    const tasks = filterPrivate(allTasks, userId);
    return Promise.all(
      tasks.map(async (t) => {
        const repo = repos.find((r) => r._id === t.repoId);
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
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'admin');
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
    // Delete prompt history
    const promptHistory = await ctx.db
      .query('promptHistory')
      .withIndex('by_task', (q) => q.eq('taskId', args.id))
      .collect();
    for (const entry of promptHistory) {
      await ctx.db.delete(entry._id);
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
    const firstId = args.ids[0];
    if (!firstId) return;

    // Validate auth once using the first task's repo
    const firstTask = await ctx.db.get(firstId);
    if (!firstTask) throw new Error('Task not found');
    const firstRepo = await ctx.db.get(firstTask.repoId);
    if (!firstRepo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(
      ctx,
      firstRepo.orgId,
    );
    requireRole(membership, 'member');
    const orgId = firstRepo.orgId;

    // Track max position per repo so tasks land in correct repo-scoped order
    const maxPositionByRepo = new Map<string, number>();
    const now = Date.now();

    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;

      // Verify task belongs to the same org
      const repo = await ctx.db.get(task.repoId);
      if (!repo || repo.orgId !== orgId) continue;
      if (task.private && task.createdBy !== userId) continue;
      if (task.status === args.status) continue;

      // Compute max position scoped to (repoId, status)
      const repoKey = task.repoId;
      if (!maxPositionByRepo.has(repoKey)) {
        const existing = await ctx.db
          .query('tasks')
          .withIndex('by_repo_status', (q) =>
            q.eq('repoId', task.repoId).eq('status', args.status),
          )
          .collect();
        maxPositionByRepo.set(
          repoKey,
          existing.reduce((max, t) => Math.max(max, t.position), 0),
        );
      }

      const nextPos = (maxPositionByRepo.get(repoKey) ?? 0) + 1;
      maxPositionByRepo.set(repoKey, nextPos);

      const updates: Record<string, unknown> = {
        status: args.status,
        position: nextPos,
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

      // Clear archive timestamp when leaving archived
      if (
        task.status === TaskStatus.Archived &&
        args.status !== TaskStatus.Archived
      ) {
        updates.archivedAt = undefined;
      }

      await ctx.db.patch(id, updates);
    }
  },
});

export const bulkDelete = mutation({
  args: { ids: v.array(v.id('tasks')) },
  handler: async (ctx, args) => {
    const firstId = args.ids[0];
    if (!firstId) return;

    // Validate auth once using the first task's repo
    const firstTask = await ctx.db.get(firstId);
    if (!firstTask) throw new Error('Task not found');
    const firstRepo = await ctx.db.get(firstTask.repoId);
    if (!firstRepo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, firstRepo.orgId);
    requireRole(membership, 'admin');
    const orgId = firstRepo.orgId;

    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;
      // Verify task belongs to the same org
      const repo = await ctx.db.get(task.repoId);
      if (!repo || repo.orgId !== orgId) continue;
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
      // Delete prompt history
      const promptHistory = await ctx.db
        .query('promptHistory')
        .withIndex('by_task', (q) => q.eq('taskId', id))
        .collect();
      for (const entry of promptHistory) {
        await ctx.db.delete(entry._id);
      }
      await ctx.db.delete(id);
    }
  },
});

export const bulkToggleLabel = mutation({
  args: {
    ids: v.array(v.id('tasks')),
    labelId: v.id('labels'),
    action: v.union(v.literal('add'), v.literal('remove')),
  },
  handler: async (ctx, args) => {
    const firstId = args.ids[0];
    if (!firstId) return;

    // Validate auth once using the first task's repo
    const firstTask = await ctx.db.get(firstId);
    if (!firstTask) throw new Error('Task not found');
    const firstRepo = await ctx.db.get(firstTask.repoId);
    if (!firstRepo) throw new Error('Repo not found');
    const { userId, membership } = await requireOrgMembership(
      ctx,
      firstRepo.orgId,
    );
    requireRole(membership, 'member');
    const orgId = firstRepo.orgId;

    // Validate label belongs to this org
    if (args.action === 'add') {
      const label = await ctx.db.get(args.labelId);
      if (!label || label.orgId !== orgId) {
        throw new Error('Label not found in this organization');
      }
    }

    const now = Date.now();
    for (const id of args.ids) {
      const task = await ctx.db.get(id);
      if (!task) continue;
      // Verify task belongs to the same org
      const repo = await ctx.db.get(task.repoId);
      if (!repo || repo.orgId !== orgId) continue;
      if (task.private && task.createdBy !== userId) continue;
      const current = task.labelIds ?? [];
      const updated =
        args.action === 'remove'
          ? current.filter((lid) => lid !== args.labelId)
          : current.includes(args.labelId)
            ? current
            : [...current, args.labelId];
      await ctx.db.patch(id, { labelIds: updated, updatedAt: now });
    }
  },
});
