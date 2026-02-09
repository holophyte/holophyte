import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

describe("seeds.create", () => {
  it("creates an active seed with title", async () => {
    const t = convexTest(schema);
    await t.mutation(api.seeds.create, { title: "Build a CLI tool" });

    const seeds = await t.query(api.seeds.list);
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      title: "Build a CLI tool",
      description: "",
      status: "active",
    });
  });

  it("creates a seed with description", async () => {
    const t = convexTest(schema);
    await t.mutation(api.seeds.create, {
      title: "Auth system",
      description: "OAuth + JWT hybrid approach",
    });

    const seeds = await t.query(api.seeds.list);
    expect(seeds[0]).toMatchObject({
      title: "Auth system",
      description: "OAuth + JWT hybrid approach",
    });
  });
});

describe("seeds.update", () => {
  it("updates seed title", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.seeds.create, { title: "Original" });
    await t.mutation(api.seeds.update, { id, title: "Updated" });

    const seeds = await t.query(api.seeds.list);
    expect(seeds[0]).toMatchObject({ title: "Updated" });
  });

  it("updates seed description", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.seeds.create, { title: "Idea" });
    await t.mutation(api.seeds.update, {
      id,
      description: "New description",
    });

    const seeds = await t.query(api.seeds.list);
    expect(seeds[0]).toMatchObject({ description: "New description" });
  });
});

describe("seeds.remove", () => {
  it("deletes a seed", async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.seeds.create, { title: "Throwaway" });
    await t.mutation(api.seeds.remove, { id });

    const seeds = await t.query(api.seeds.list);
    expect(seeds).toHaveLength(0);
  });
});

describe("seeds.plant", () => {
  it("creates a task in the repo backlog and marks seed as planted", async () => {
    const t = convexTest(schema);

    // Create a repo
    const repoId = await t.run(async (ctx) => {
      return await ctx.db.insert("repos", {
        name: "test-repo",
        path: "/tmp/test-repo",
        createdAt: Date.now(),
      });
    });

    // Create and plant a seed
    const seedId = await t.mutation(api.seeds.create, {
      title: "Great idea",
      description: "Details here",
    });
    const taskId = await t.mutation(api.seeds.plant, {
      id: seedId,
      repoId,
      prompt: "implement this",
    });

    // Seed should be planted
    const seeds = await t.query(api.seeds.list);
    expect(seeds[0]).toMatchObject({
      status: "planted",
      plantedToTaskId: taskId,
    });

    // Task should exist in repo's backlog
    const tasks = await t.query(api.tasks.listByRepo, { repoId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "Great idea",
      description: "Details here",
      prompt: "implement this",
      status: "backlog",
      repoId,
    });
  });

  it("plants without a prompt", async () => {
    const t = convexTest(schema);

    const repoId = await t.run(async (ctx) => {
      return await ctx.db.insert("repos", {
        name: "repo",
        path: "/tmp/repo",
        createdAt: Date.now(),
      });
    });

    const seedId = await t.mutation(api.seeds.create, { title: "Idea" });
    await t.mutation(api.seeds.plant, { id: seedId, repoId });

    const tasks = await t.query(api.tasks.listByRepo, { repoId });
    expect(tasks[0]).toMatchObject({ prompt: "" });
  });

  it("calculates position after existing backlog tasks", async () => {
    const t = convexTest(schema);

    const repoId = await t.run(async (ctx) => {
      return await ctx.db.insert("repos", {
        name: "repo",
        path: "/tmp/repo",
        createdAt: Date.now(),
      });
    });

    // Create an existing task
    await t.mutation(api.tasks.create, {
      repoId,
      title: "Existing task",
    });

    // Plant a seed
    const seedId = await t.mutation(api.seeds.create, { title: "New idea" });
    await t.mutation(api.seeds.plant, { id: seedId, repoId });

    const tasks = await t.query(api.tasks.listByRepo, { repoId });
    const positions = tasks.map((t) => t.position).sort((a, b) => a - b);
    expect(positions[1]).toBeGreaterThan(positions[0]!);
  });
});
