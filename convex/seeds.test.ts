// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema, { TaskStatus } from './schema';

/** Create a user and return an authenticated test client + userId. */
async function setupUser(t: ReturnType<typeof convexTest>, name = 'Test User') {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert('users', { name });
  });
  return { userId, authed: t.withIdentity({ subject: `${userId}|s1` }) };
}

/** Create user + org + repo, return everything needed. */
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

describe('seeds.create', () => {
  it('creates an active seed with title', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await (async () => {
      const { userId, authed } = await setupUser(t, 'Owner');
      const orgId = await authed.mutation(api.organizations.create, {
        name: 'Test Org',
        slug: 'test-org',
      });
      return { authed, orgId };
    })();

    await authed.mutation(api.seeds.create, {
      title: 'Build a CLI tool',
      orgId,
    });

    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds).toHaveLength(1);
    expect(seeds[0]).toMatchObject({
      title: 'Build a CLI tool',
      description: '',
      status: 'active',
    });
  });

  it('creates a seed with description', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await (async () => {
      const { authed } = await setupUser(t, 'Owner');
      const orgId = await authed.mutation(api.organizations.create, {
        name: 'Test Org',
        slug: 'test-org',
      });
      return { authed, orgId };
    })();

    await authed.mutation(api.seeds.create, {
      title: 'Auth system',
      description: 'OAuth + JWT hybrid approach',
      orgId,
    });

    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds[0]).toMatchObject({
      title: 'Auth system',
      description: 'OAuth + JWT hybrid approach',
    });
  });
});

describe('seeds.update', () => {
  it('updates seed title', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await (async () => {
      const { authed } = await setupUser(t, 'Owner');
      const orgId = await authed.mutation(api.organizations.create, {
        name: 'Org',
        slug: 'org',
      });
      return { authed, orgId };
    })();

    const id = await authed.mutation(api.seeds.create, {
      title: 'Original',
      orgId,
    });
    await authed.mutation(api.seeds.update, { id, title: 'Updated' });

    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds[0]).toMatchObject({ title: 'Updated' });
  });

  it('updates seed description', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await (async () => {
      const { authed } = await setupUser(t, 'Owner');
      const orgId = await authed.mutation(api.organizations.create, {
        name: 'Org',
        slug: 'org',
      });
      return { authed, orgId };
    })();

    const id = await authed.mutation(api.seeds.create, {
      title: 'Idea',
      orgId,
    });
    await authed.mutation(api.seeds.update, {
      id,
      description: 'New description',
    });

    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds[0]).toMatchObject({ description: 'New description' });
  });
});

describe('seeds.remove', () => {
  it('deletes a seed', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await (async () => {
      const { authed } = await setupUser(t, 'Owner');
      const orgId = await authed.mutation(api.organizations.create, {
        name: 'Org',
        slug: 'org',
      });
      return { authed, orgId };
    })();

    const id = await authed.mutation(api.seeds.create, {
      title: 'Throwaway',
      orgId,
    });
    await authed.mutation(api.seeds.remove, { id });

    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds).toHaveLength(0);
  });
});

describe('seeds.plant', () => {
  it('creates a task in the repo backlog and marks seed as planted', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const seedId = await authed.mutation(api.seeds.create, {
      title: 'Great idea',
      description: 'Details here',
      orgId,
    });
    const taskId = await authed.mutation(api.seeds.plant, {
      id: seedId,
      repoId,
      prompt: 'implement this',
    });

    // Seed should be planted
    const seeds = await authed.query(api.seeds.list, { orgId });
    expect(seeds[0]).toMatchObject({
      status: 'planted',
      plantedToTaskId: taskId,
    });

    // Task should exist in repo's backlog
    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Great idea',
      description: 'Details here',
      prompt: 'implement this',
      status: TaskStatus.Backlog,
      repoId,
    });
  });

  it('plants without a prompt', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    const seedId = await authed.mutation(api.seeds.create, {
      title: 'Idea',
      orgId,
    });
    await authed.mutation(api.seeds.plant, { id: seedId, repoId });

    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    expect(tasks[0]).toMatchObject({ prompt: '' });
  });

  it('calculates position after existing backlog tasks', async () => {
    const t = convexTest(schema);
    const { authed, orgId, repoId } = await setupRepoEnv(t);

    // Create an existing task
    await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Existing task',
    });

    // Plant a seed
    const seedId = await authed.mutation(api.seeds.create, {
      title: 'New idea',
      orgId,
    });
    await authed.mutation(api.seeds.plant, { id: seedId, repoId });

    const tasks = await authed.query(api.tasks.listByRepo, { repoId });
    const positions = tasks.map((t) => t.position).sort((a, b) => a - b);
    expect(positions[1]).toBeGreaterThan(positions[0]!);
  });
});
