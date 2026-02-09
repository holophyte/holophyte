import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    const subtasks = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
    return subtasks.sort((a, b) => a.position - b.position);
  },
});

export const countsByTasks = query({
  args: { taskIds: v.array(v.id("tasks")) },
  handler: async (ctx, args) => {
    const counts: Record<string, { total: number; completed: number }> = {};
    for (const taskId of args.taskIds) {
      const subtasks = await ctx.db
        .query("subtasks")
        .withIndex("by_task", (q) => q.eq("taskId", taskId))
        .collect();
      if (subtasks.length > 0) {
        counts[taskId] = {
          total: subtasks.length,
          completed: subtasks.filter((s) => s.completed).length,
        };
      }
    }
    return counts;
  },
});

export const create = mutation({
  args: {
    taskId: v.id("tasks"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subtasks")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
    const maxPosition = existing.reduce(
      (max, s) => Math.max(max, s.position),
      0,
    );
    return await ctx.db.insert("subtasks", {
      taskId: args.taskId,
      title: args.title,
      completed: false,
      position: maxPosition + 1,
      createdAt: Date.now(),
    });
  },
});

export const toggle = mutation({
  args: { id: v.id("subtasks") },
  handler: async (ctx, args) => {
    const subtask = await ctx.db.get(args.id);
    if (!subtask) return;
    await ctx.db.patch(args.id, { completed: !subtask.completed });
  },
});

export const updateTitle = mutation({
  args: { id: v.id("subtasks"), title: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { title: args.title });
  },
});

export const remove = mutation({
  args: { id: v.id("subtasks") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
