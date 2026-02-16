// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

/** Create a user and return an authenticated test client + userId. */
async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

/** Create user + org as owner, return everything. */
async function setupOwnerWithOrg(t: ReturnType<typeof convexTest>) {
  const { userId, authed } = await setupUser(t, 'Owner');
  const orgId = await authed.mutation(api.organizations.create, {
    name: 'Test Org',
    slug: 'test-org',
  });
  return { userId, authed, orgId };
}

describe('labels.create', () => {
  it('creates a label with name, color, and orgId', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
      orgId,
    });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      _id: id,
      name: 'Bug',
      color: '#ef4444',
      orgId,
    });
  });
});

describe('labels.update', () => {
  it('updates label name', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
      orgId,
    });

    await authed.mutation(api.labels.update, { id, name: 'Critical Bug' });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels[0]).toMatchObject({
      name: 'Critical Bug',
      color: '#ef4444',
    });
  });

  it('updates label color', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Feature',
      color: '#3b82f6',
      orgId,
    });

    await authed.mutation(api.labels.update, { id, color: '#22c55e' });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels[0]).toMatchObject({
      name: 'Feature',
      color: '#22c55e',
    });
  });

  it('updates both name and color', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Old',
      color: '#000000',
      orgId,
    });

    await authed.mutation(api.labels.update, {
      id,
      name: 'New',
      color: '#ffffff',
    });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels[0]).toMatchObject({ name: 'New', color: '#ffffff' });
  });
});

describe('labels.remove', () => {
  it('deletes a label', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Temp',
      color: '#6b7280',
      orgId,
    });

    await authed.mutation(api.labels.remove, { id });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels).toHaveLength(0);
  });

  it('removes label from tasks that reference it', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const repoId = await authed.mutation(api.repos.create, {
      name: 'test-repo',
      path: '/tmp/test-repo',
      orgId,
    });
    const labelId = await authed.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
      orgId,
    });
    const otherLabelId = await authed.mutation(api.labels.create, {
      name: 'Feature',
      color: '#3b82f6',
      orgId,
    });

    // Create task with both labels
    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Task with labels',
      labelIds: [labelId, otherLabelId],
    });

    // Delete the first label
    await authed.mutation(api.labels.remove, { id: labelId });

    // Task should only have the remaining label
    const task = await authed.query(api.tasks.get, { id: taskId });
    expect(task?.labelIds).toEqual([otherLabelId]);
  });

  it('handles deletion when no tasks reference the label', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const id = await authed.mutation(api.labels.create, {
      name: 'Unused',
      color: '#6b7280',
      orgId,
    });

    // Should not throw
    await authed.mutation(api.labels.remove, { id });

    const labels = await authed.query(api.labels.list, { orgId });
    expect(labels).toHaveLength(0);
  });
});

describe('labels with tasks', () => {
  it('tasks.get returns resolved labels', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const repoId = await authed.mutation(api.repos.create, {
      name: 'test-repo',
      path: '/tmp/test-repo',
      orgId,
    });

    const labelId = await authed.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
      orgId,
    });

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Labeled task',
      labelIds: [labelId],
    });

    const task = await authed.query(api.tasks.get, { id: taskId });
    expect(task?.labels).toHaveLength(1);
    expect(task?.labels[0]).toMatchObject({
      name: 'Bug',
      color: '#ef4444',
    });
  });
});

describe('labels - personal labels', () => {
  it('personal labels are only visible to their creator', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId, authed: member } = await setupUser(t, 'Member');

    // Add member to org
    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    // Owner creates a personal label
    await owner.mutation(api.labels.create, {
      name: 'My Label',
      color: '#ff0000',
      orgId,
      personal: true,
    });

    // Owner creates a shared label
    await owner.mutation(api.labels.create, {
      name: 'Shared Label',
      color: '#00ff00',
      orgId,
    });

    // Owner sees both
    const ownerLabels = await owner.query(api.labels.list, { orgId });
    expect(ownerLabels).toHaveLength(2);

    // Member only sees the shared label
    const memberLabels = await member.query(api.labels.list, { orgId });
    expect(memberLabels).toHaveLength(1);
    expect(memberLabels[0]?.name).toBe('Shared Label');
  });
});
