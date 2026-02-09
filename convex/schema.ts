import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  repos: defineTable({
    name: v.string(),
    path: v.string(),
    createdAt: v.number(),
  }).index("by_path", ["path"]),

  tasks: defineTable({
    repoId: v.id("repos"),
    title: v.string(),
    description: v.string(),
    prompt: v.string(),
    status: v.union(
      v.literal("backlog"),
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done"),
    ),
    position: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_repo_status", ["repoId", "status"])
    .index("by_status", ["status"]),

  seeds: defineTable({
    title: v.string(),
    description: v.string(),
    status: v.union(v.literal("active"), v.literal("planted")),
    plantedToTaskId: v.optional(v.id("tasks")),
    createdAt: v.number(),
  }).index("by_status", ["status"]),

  sessions: defineTable({
    taskId: v.id("tasks"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("stopped"),
    ),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
  })
    .index("by_task", ["taskId"])
    .index("by_status", ["status"]),
});
