import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { taskStatusValidator } from "./schema";

export const listByRepo = query({
  args: { repoId: v.id("repos"), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("tasks")
      .withIndex("by_repo_status", (q) => q.eq("repoId", args.repoId))
      .collect();
    if (args.includeArchived) return tasks;
    return tasks.filter((t) => t.status !== "archived");
  },
});

export const listAll = query({
  args: { includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const tasks = await ctx.db.query("tasks").collect();
    if (args.includeArchived) return tasks;
    return tasks.filter((t) => t.status !== "archived");
  },
});

export const listArchived = query({
  args: { repoId: v.optional(v.id("repos")) },
  handler: async (ctx, args) => {
    let tasks;
    if (args.repoId) {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_repo_status", (q) =>
          q.eq("repoId", args.repoId).eq("status", "archived"),
        )
        .collect();
    } else {
      tasks = await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", "archived"))
        .collect();
    }
    return tasks.sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  },
});

export const get = query({
  args: { id: v.id("tasks") },
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
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    const subtaskTotal = subtasks.length;
    const subtaskCompleted = subtasks.filter((s) => s.completed).length;

    return { ...task, repo, labels, subtaskTotal, subtaskCompleted };
  },
});

export const create = mutation({
  args: {
    repoId: v.id("repos"),
    title: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    labelIds: v.optional(v.array(v.id("labels"))),
    dueAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("tasks")
      .withIndex("by_repo_status", (q) =>
        q.eq("repoId", args.repoId).eq("status", "backlog"),
      )
      .collect();
    const maxPosition = existing.reduce(
      (max, t) => Math.max(max, t.position),
      0,
    );
    const now = Date.now();
    return await ctx.db.insert("tasks", {
      repoId: args.repoId,
      title: args.title,
      description: args.description ?? "",
      prompt: args.prompt ?? "",
      status: "backlog",
      position: maxPosition + 1,
      createdAt: now,
      updatedAt: now,
      labelIds: args.labelIds,
      dueAt: args.dueAt,
      totalInProgressMs: 0,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
    labelIds: v.optional(v.array(v.id("labels"))),
    dueAt: v.optional(v.number()),
    clearDueAt: v.optional(v.boolean()),
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
    await ctx.db.patch(id, updates);
  },
});

export const move = mutation({
  args: {
    id: v.id("tasks"),
    status: taskStatusValidator,
    position: v.number(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) throw new Error("Task not found");

    const now = Date.now();
    const updates: Record<string, unknown> = {
      status: args.status,
      position: args.position,
      updatedAt: now,
    };

    // Time tracking: leaving in_progress
    if (task.status === "in_progress" && args.status !== "in_progress") {
      const elapsed = task.inProgressSince ? now - task.inProgressSince : 0;
      updates.totalInProgressMs = (task.totalInProgressMs ?? 0) + elapsed;
      updates.inProgressSince = undefined;
    }

    // Time tracking: entering in_progress
    if (task.status !== "in_progress" && args.status === "in_progress") {
      updates.inProgressSince = now;
    }

    // Archive timestamp
    if (args.status === "archived") {
      updates.archivedAt = now;
    }

    await ctx.db.patch(args.id, updates);
  },
});

export const reorder = mutation({
  args: {
    id: v.id("tasks"),
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
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task || task.status !== "archived") return;
    const doneTasks = await ctx.db
      .query("tasks")
      .withIndex("by_repo_status", (q) =>
        q.eq("repoId", task.repoId).eq("status", "done"),
      )
      .collect();
    const maxPosition = doneTasks.reduce(
      (max, t) => Math.max(max, t.position),
      0,
    );
    await ctx.db.patch(args.id, {
      status: "done",
      position: maxPosition + 1,
      archivedAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const archiveAllDone = mutation({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    const doneTasks = await ctx.db
      .query("tasks")
      .withIndex("by_repo_status", (q) =>
        q.eq("repoId", args.repoId).eq("status", "done"),
      )
      .collect();
    const now = Date.now();
    for (const task of doneTasks) {
      await ctx.db.patch(task._id, {
        status: "archived",
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
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .collect();
    const inReview = await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "review"))
      .collect();
    const tasks = [...inProgress, ...inReview];
    return Promise.all(
      tasks.map(async (t) => {
        const repo = await ctx.db.get(t.repoId);
        const sessions = await ctx.db
          .query("sessions")
          .withIndex("by_task", (q) => q.eq("taskId", t._id))
          .collect();
        const hasRunningSession = sessions.some((s) => s.status === "running");
        return { ...t, repoName: repo?.name, hasRunningSession };
      }),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    // Delete sessions
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    // Delete subtasks
    const subtasks = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    for (const subtask of subtasks) {
      await ctx.db.delete(subtask._id);
    }
    await ctx.db.delete(args.id);
  },
});
