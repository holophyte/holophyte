import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByRepo = query({
  args: { repoId: v.id("repos") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_repo_status", (q) => q.eq("repoId", args.repoId))
      .collect();
  },
});

export const listAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("tasks").collect();
  },
});

export const get = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.id);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    return { ...task, repo };
  },
});

export const create = mutation({
  args: {
    repoId: v.id("repos"),
    title: v.string(),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
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
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("tasks"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, string | number> = { updatedAt: Date.now() };
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined)
      updates.description = fields.description;
    if (fields.prompt !== undefined) updates.prompt = fields.prompt;
    await ctx.db.patch(id, updates);
  },
});

export const move = mutation({
  args: {
    id: v.id("tasks"),
    status: v.union(
      v.literal("backlog"),
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done"),
    ),
    position: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: args.status,
      position: args.position,
      updatedAt: Date.now(),
    });
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
        return { ...t, repoName: repo?.name };
      }),
    );
  },
});

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_task", (q) => q.eq("taskId", args.id))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    await ctx.db.delete(args.id);
  },
});
