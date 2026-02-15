// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema, { TaskPriority, TaskStatus } from './schema';

/** Create a user and return an authenticated test client + userId. */
async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

/** Create user + org + repo, return everything needed for task tests. */
async function setupRepoEnv(t: ReturnType<typeof convexTest>) {
  const { userId, authed } = await setupUser(t, 'Owner');
  const orgId = await authed.mutation(api.organizations.create, {
    name: 'Test Org',
    slug: 'test-org',
  });
  const repoId = await authed.mutation(api.repos.create, {
    name: 'test-repo',
    path: '/tmp/test-repo',
    orgId,
  });
  return { userId, authed, orgId, repoId };
}

describe('tasks.create', () => {
  it('creates a task in backlog with createdBy set', async () => {
    const t = convexTest(schema);
    const { userId, authed, repoId } = await setupRepoEnv(t);

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'My task',
    });

    const task = await authed.query(api.tasks.get, { id: taskId });
    expect(task).toMatchObject({
      title: 'My task',
      description: '',
      prompt: '',
      status: TaskStatus.Backlog,
      position: 1,
      createdBy: userId,
    });
  });

  it('auto-increments position for multiple tasks', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);

    await authed.mutation(api.tasks.create, { repoId, title: 'First' });
    await authed.mutation(api.tasks.create, { repoId, title: 'Second' });
    await authed.mutation(api.tasks.create, { repoId, title: 'Third' });

    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    const positions = tasks.map((t) => t.position).sort((a, b) => a - b);
    expect(positions).toEqual([1, 2, 3]);
  });

  it('creates a task with a specific status', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);

    await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Todo task',
      status: TaskStatus.Todo,
    });

    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Todo task',
      status: TaskStatus.Todo,
      position: 1,
    });
  });

  it('creates a task with priority', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);

    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Urgent bug',
      priority: TaskPriority.Urgent,
    });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      title: 'Urgent bug',
      priority: TaskPriority.Urgent,
    });
  });

  it('requires membership', async () => {
    const t = convexTest(schema);
    const { repoId } = await setupRepoEnv(t);
    const { authed: outsider } = await setupUser(t, 'Outsider');

    await expect(
      outsider.mutation(api.tasks.create, { repoId, title: 'Nope' }),
    ).rejects.toThrow('Not a member of this organization');
  });
});

describe('tasks.update', () => {
  it('updates task fields', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Old title',
    });

    await authed.mutation(api.tasks.update, {
      id,
      title: 'New title',
      description: 'Added desc',
      prompt: 'do something',
    });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      title: 'New title',
      description: 'Added desc',
      prompt: 'do something',
    });
  });

  it('updates task priority', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Task',
    });

    await authed.mutation(api.tasks.update, {
      id,
      priority: TaskPriority.High,
    });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toMatchObject({ priority: TaskPriority.High });
  });
});

describe('tasks.move', () => {
  it('changes task status and position', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Task',
    });

    await authed.mutation(api.tasks.move, {
      id,
      status: TaskStatus.InProgress,
      position: 1,
    });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      status: TaskStatus.InProgress,
      position: 1,
    });
  });
});

describe('tasks - private tasks', () => {
  it('private tasks are visible to their creator', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Secret task',
      private: true,
    });

    const task = await authed.query(api.tasks.get, { id: taskId });
    expect(task).not.toBeNull();
    expect(task!.title).toBe('Secret task');
    expect(task!.private).toBe(true);

    // Also visible in listByRepo
    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    expect(tasks.some((t) => t._id === taskId)).toBe(true);
  });

  it('private tasks are hidden from other org members', async () => {
    const t = convexTest(schema);
    const { authed: creator, orgId, repoId } = await setupRepoEnv(t);
    const { userId: otherId, authed: otherMember } = await setupUser(
      t,
      'Other',
    );

    // Add other user as member
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: otherId,
        orgId,
        role: 'member',
      });
    });

    // Creator makes a private task
    const privateTaskId = await creator.mutation(api.tasks.create, {
      repoId,
      title: 'Private',
      private: true,
    });
    // And a public task
    await creator.mutation(api.tasks.create, {
      repoId,
      title: 'Public',
    });

    // Other member should not see private task
    const otherTasks = await otherMember.query(api.tasks.listByRepo, {
      repoId,
    });
    expect(otherTasks).toHaveLength(1);
    expect(otherTasks[0]!.title).toBe('Public');

    // tasks.get should return null for private task
    const hidden = await otherMember.query(api.tasks.get, {
      id: privateTaskId,
    });
    expect(hidden).toBeNull();
  });
});

describe('tasks.listActive', () => {
  it('returns in_progress and review tasks with repo names', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const id1 = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Working',
    });
    const id2 = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Reviewing',
    });
    await authed.mutation(api.tasks.create, { repoId, title: 'Backlog item' });

    await authed.mutation(api.tasks.move, {
      id: id1,
      status: TaskStatus.InProgress,
      position: 1,
    });
    await authed.mutation(api.tasks.move, {
      id: id2,
      status: TaskStatus.Review,
      position: 1,
    });

    const active = await authed.query(api.tasks.listActive, { orgId });
    expect(active).toHaveLength(2);

    const titles = active.map((t) => t.title).sort();
    expect(titles).toEqual(['Reviewing', 'Working']);
    expect(active[0]!.repoName).toBe('test-repo');
    expect(active[0]!.hasRunningSession).toBe(false);
  });

  it('excludes done and backlog tasks', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Done task',
    });
    await authed.mutation(api.tasks.move, {
      id,
      status: TaskStatus.Done,
      position: 1,
    });

    const active = await authed.query(api.tasks.listActive, { orgId });
    expect(active).toHaveLength(0);
  });
});

describe('tasks.remove', () => {
  it('deletes task and its sessions', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'To delete',
    });

    // Create a session for the task
    await t.run(async (ctx) => {
      await ctx.db.insert('sessions', {
        taskId,
        status: 'completed',
        startedAt: Date.now(),
        endedAt: Date.now(),
      });
    });

    await authed.mutation(api.tasks.remove, { id: taskId });

    const tasks = await t.run(async (ctx) => {
      return await ctx.db.query('tasks').collect();
    });
    expect(tasks).toHaveLength(0);

    const sessions = await t.run(async (ctx) => {
      return await ctx.db.query('sessions').collect();
    });
    expect(sessions).toHaveLength(0);
  });
});

describe('tasks.get', () => {
  it('returns task with repo data', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'My task',
    });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toMatchObject({
      title: 'My task',
      repo: { name: 'test-repo', path: '/tmp/test-repo' },
    });
  });

  it('returns null for non-existent task', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    const id = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Temp',
    });
    await authed.mutation(api.tasks.remove, { id });

    const task = await authed.query(api.tasks.get, { id });
    expect(task).toBeNull();
  });
});

describe('tasks - org scoping through repo', () => {
  it('cannot create tasks in repos of other orgs', async () => {
    const t = convexTest(schema);
    const { repoId } = await setupRepoEnv(t);
    const { authed: outsider } = await setupUser(t, 'Outsider');

    await expect(
      outsider.mutation(api.tasks.create, { repoId, title: 'Hack' }),
    ).rejects.toThrow('Not a member of this organization');
  });

  it('cannot list tasks in repos of other orgs', async () => {
    const t = convexTest(schema);
    const { authed, repoId } = await setupRepoEnv(t);
    await authed.mutation(api.tasks.create, { repoId, title: 'Task' });

    const { authed: outsider } = await setupUser(t, 'Outsider');

    await expect(
      outsider.query(api.tasks.listByRepo, { repoId }),
    ).rejects.toThrow('Not a member of this organization');
  });
});
