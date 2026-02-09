import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("seeds").collect();
  },
});

export const create = mutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("seeds", {
      title: args.title,
      description: args.description ?? "",
      status: "active",
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("seeds"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, string> = {};
    if (fields.title !== undefined) updates.title = fields.title;
    if (fields.description !== undefined)
      updates.description = fields.description;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("seeds") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

export const plant = mutation({
  args: {
    id: v.id("seeds"),
    repoId: v.id("repos"),
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const seed = await ctx.db.get(args.id);
    if (!seed) throw new Error("Seed not found");

    // Calculate position for new task in backlog
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
    const taskId = await ctx.db.insert("tasks", {
      repoId: args.repoId,
      title: seed.title,
      description: seed.description,
      prompt: args.prompt ?? "",
      status: "backlog",
      position: maxPosition + 1,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.id, {
      status: "planted",
      plantedToTaskId: taskId,
    });

    return taskId;
  },
});
