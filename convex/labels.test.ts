import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

describe('labels.create', () => {
  it('creates a label with name and color', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
    });

    const labels = await t.query(api.labels.list);
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({
      _id: id,
      name: 'Bug',
      color: '#ef4444',
    });
  });
});

describe('labels.update', () => {
  it('updates label name', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
    });

    await t.mutation(api.labels.update, { id, name: 'Critical Bug' });

    const labels = await t.query(api.labels.list);
    expect(labels[0]).toMatchObject({ name: 'Critical Bug', color: '#ef4444' });
  });

  it('updates label color', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Feature',
      color: '#3b82f6',
    });

    await t.mutation(api.labels.update, { id, color: '#22c55e' });

    const labels = await t.query(api.labels.list);
    expect(labels[0]).toMatchObject({ name: 'Feature', color: '#22c55e' });
  });

  it('updates both name and color', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Old',
      color: '#000000',
    });

    await t.mutation(api.labels.update, {
      id,
      name: 'New',
      color: '#ffffff',
    });

    const labels = await t.query(api.labels.list);
    expect(labels[0]).toMatchObject({ name: 'New', color: '#ffffff' });
  });
});

describe('labels.remove', () => {
  it('deletes a label', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Temp',
      color: '#6b7280',
    });

    await t.mutation(api.labels.remove, { id });

    const labels = await t.query(api.labels.list);
    expect(labels).toHaveLength(0);
  });

  it('removes label from tasks that reference it', async () => {
    const t = convexTest(schema);

    // Create repo and label
    const repoId = await t.run(async (ctx) => {
      return await ctx.db.insert('repos', {
        name: 'test-repo',
        path: '/tmp/test-repo',
        createdAt: Date.now(),
      });
    });
    const labelId = await t.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
    });
    const otherLabelId = await t.mutation(api.labels.create, {
      name: 'Feature',
      color: '#3b82f6',
    });

    // Create task with both labels
    const taskId = await t.mutation(api.tasks.create, {
      repoId,
      title: 'Task with labels',
      labelIds: [labelId, otherLabelId],
    });

    // Delete the first label
    await t.mutation(api.labels.remove, { id: labelId });

    // Task should only have the remaining label
    const task = await t.query(api.tasks.get, { id: taskId });
    expect(task?.labelIds).toEqual([otherLabelId]);
  });

  it('handles deletion when no tasks reference the label', async () => {
    const t = convexTest(schema);
    const id = await t.mutation(api.labels.create, {
      name: 'Unused',
      color: '#6b7280',
    });

    // Should not throw
    await t.mutation(api.labels.remove, { id });

    const labels = await t.query(api.labels.list);
    expect(labels).toHaveLength(0);
  });
});

describe('labels with tasks', () => {
  it('tasks.get returns resolved labels', async () => {
    const t = convexTest(schema);

    const repoId = await t.run(async (ctx) => {
      return await ctx.db.insert('repos', {
        name: 'test-repo',
        path: '/tmp/test-repo',
        createdAt: Date.now(),
      });
    });

    const labelId = await t.mutation(api.labels.create, {
      name: 'Bug',
      color: '#ef4444',
    });

    const taskId = await t.mutation(api.tasks.create, {
      repoId,
      title: 'Labeled task',
      labelIds: [labelId],
    });

    const task = await t.query(api.tasks.get, { id: taskId });
    expect(task?.labels).toHaveLength(1);
    expect(task?.labels[0]).toMatchObject({ name: 'Bug', color: '#ef4444' });
  });
});
