import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// Helper to create a repo
async function createRepo(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("repos", {
      name: "test-repo",
      path: "/tmp/test-repo",
      createdAt: Date.now(),
    });
  });
}

describe("tasks.create", () => {
  it("creates a task in backlog with position 1", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);

    const taskId = await t.mutation(api.tasks.create, {
      repoId,
      title: "My task",
    });

    const tasks = await t.query(api.tasks.listByRepo, { repoId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: "My task",
      description: "",
      prompt: "",
      status: "backlog",
      position: 1,
      repoId,
    });
    expect(tasks[0]._id).toBe(taskId);
  });

  it("auto-increments position for multiple tasks", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);

    await t.mutation(api.tasks.create, { repoId, title: "First" });
    await t.mutation(api.tasks.create, { repoId, title: "Second" });
    await t.mutation(api.tasks.create, { repoId, title: "Third" });

    const tasks = await t.query(api.tasks.listByRepo, { repoId });
    const positions = tasks.map((t) => t.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3]);
  });
});

describe("tasks.update", () => {
  it("updates task fields", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);
    const id = await t.mutation(api.tasks.create, {
      repoId,
      title: "Old title",
    });

    await t.mutation(api.tasks.update, {
      id,
      title: "New title",
      description: "Added desc",
      prompt: "do something",
    });

    const task = await t.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      title: "New title",
      description: "Added desc",
      prompt: "do something",
    });
  });
});

describe("tasks.move", () => {
  it("changes task status and position", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);
    const id = await t.mutation(api.tasks.create, {
      repoId,
      title: "Task",
    });

    await t.mutation(api.tasks.move, {
      id,
      status: "in_progress",
      position: 1,
    });

    const task = await t.query(api.tasks.get, { id });
    expect(task).toMatchObject({ status: "in_progress", position: 1 });
  });
});

describe("tasks.listActive", () => {
  it("returns in_progress and review tasks with repo names", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);

    const id1 = await t.mutation(api.tasks.create, {
      repoId,
      title: "Working",
    });
    const id2 = await t.mutation(api.tasks.create, {
      repoId,
      title: "Reviewing",
    });
    await t.mutation(api.tasks.create, { repoId, title: "Backlog item" });

    await t.mutation(api.tasks.move, {
      id: id1,
      status: "in_progress",
      position: 1,
    });
    await t.mutation(api.tasks.move, {
      id: id2,
      status: "review",
      position: 1,
    });

    const active = await t.query(api.tasks.listActive);
    expect(active).toHaveLength(2);

    const titles = active.map((t) => t.title).sort();
    expect(titles).toEqual(["Reviewing", "Working"]);
    expect(active[0].repoName).toBe("test-repo");
    expect(active[0].hasRunningSession).toBe(false);
  });

  it("detects running sessions", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);

    const taskId = await t.mutation(api.tasks.create, {
      repoId,
      title: "Active",
    });
    await t.mutation(api.tasks.move, {
      id: taskId,
      status: "in_progress",
      position: 1,
    });

    // Create a running session
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        taskId,
        status: "running",
        startedAt: Date.now(),
      });
    });

    const active = await t.query(api.tasks.listActive);
    expect(active).toHaveLength(1);
    expect(active[0].hasRunningSession).toBe(true);
  });

  it("excludes done and backlog tasks", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);

    const id = await t.mutation(api.tasks.create, {
      repoId,
      title: "Done task",
    });
    await t.mutation(api.tasks.move, {
      id,
      status: "done",
      position: 1,
    });

    const active = await t.query(api.tasks.listActive);
    expect(active).toHaveLength(0);
  });
});

describe("tasks.remove", () => {
  it("deletes task and its sessions", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);
    const taskId = await t.mutation(api.tasks.create, {
      repoId,
      title: "To delete",
    });

    // Create a session for the task
    await t.run(async (ctx) => {
      await ctx.db.insert("sessions", {
        taskId,
        status: "completed",
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
    });

    await t.mutation(api.tasks.remove, { id: taskId });

    const tasks = await t.query(api.tasks.listAll, {});
    expect(tasks).toHaveLength(0);

    // Sessions should be cleaned up too
    const sessions = await t.run(async (ctx) => {
      return await ctx.db.query("sessions").collect();
    });
    expect(sessions).toHaveLength(0);
  });
});

describe("tasks.get", () => {
  it("returns task with repo data", async () => {
    const t = convexTest(schema);
    const repoId = await createRepo(t);
    const id = await t.mutation(api.tasks.create, {
      repoId,
      title: "My task",
    });

    const task = await t.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      title: "My task",
      repo: { name: "test-repo", path: "/tmp/test-repo" },
    });
  });

  it("returns null for non-existent task", async () => {
    const t = convexTest(schema);
    // Use a valid-looking but non-existent ID
    const repoId = await createRepo(t);
    const id = await t.mutation(api.tasks.create, {
      repoId,
      title: "Temp",
    });
    await t.mutation(api.tasks.remove, { id });

    const task = await t.query(api.tasks.get, { id });
    expect(task).toBeNull();
  });
});
