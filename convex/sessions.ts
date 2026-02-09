import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listActive = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();
  },
});

export const getByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
    return sessions.length > 0 ? sessions[sessions.length - 1] : null;
  },
});

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("sessions", {
      taskId: args.taskId,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("sessions"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped"),
    ),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { status: args.status };
    if (args.status !== "running") {
      updates.endedAt = Date.now();
    }
    await ctx.db.patch(args.id, updates);
  },
});
