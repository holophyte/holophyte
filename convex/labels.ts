import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("labels").collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("labels", {
      name: args.name,
      color: args.color,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("labels"),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...fields } = args;
    const updates: Record<string, string> = {};
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.color !== undefined) updates.color = fields.color;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id("labels") },
  handler: async (ctx, args) => {
    // Remove this label ID from all tasks that reference it
    const allTasks = await ctx.db.query("tasks").collect();
    for (const task of allTasks) {
      const labelIds = task.labelIds ?? [];
      if (labelIds.includes(args.id)) {
        await ctx.db.patch(task._id, {
          labelIds: labelIds.filter((lid) => lid !== args.id),
        });
      }
    }
    await ctx.db.delete(args.id);
  },
});
