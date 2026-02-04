import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Example table - modify as needed
  tasks: defineTable({
    text: v.string(),
    isCompleted: v.boolean(),
  }),
});
