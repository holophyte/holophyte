// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema, { TaskStatus } from './schema';

async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

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

describe('activityLog', () => {
  it('creating a task inserts an activity log entry', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    await authed.mutation(api.tasks.create, {
      repoId,
      title: 'New Task',
    });

    const entries = await authed.query(api.activityLog.list, { orgId });

    // At least repo.created + task.created
    expect(entries.length).toBeGreaterThanOrEqual(2);

    const taskCreated = entries.find((e) => e.action === 'task.created');
    expect(taskCreated).toBeDefined();
    expect(taskCreated?.entityType).toBe('task');

    const metadata = JSON.parse(taskCreated?.metadata ?? '{}');
    expect(metadata.status).toBe(TaskStatus.Backlog);
  });

  it('moving a task logs from/to statuses', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Movable Task',
    });

    await authed.mutation(api.tasks.move, {
      id: taskId,
      status: TaskStatus.InProgress,
      position: 1,
    });

    const entries = await authed.query(api.activityLog.list, { orgId });

    const taskMoved = entries.find((e) => e.action === 'task.moved');
    expect(taskMoved).toBeDefined();

    const metadata = JSON.parse(taskMoved?.metadata ?? '{}');
    expect(metadata.from).toBe(TaskStatus.Backlog);
    expect(metadata.to).toBe(TaskStatus.InProgress);
  });

  it('deleting a task logs the title', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Task to delete',
    });

    await authed.mutation(api.tasks.remove, { id: taskId });

    const entries = await authed.query(api.activityLog.list, { orgId });

    const taskDeleted = entries.find((e) => e.action === 'task.deleted');
    expect(taskDeleted).toBeDefined();

    const metadata = JSON.parse(taskDeleted?.metadata ?? '{}');
    expect(metadata.title).toBe('Task to delete');
  });
});
