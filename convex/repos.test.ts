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

/** Create a user + org as owner, return everything. */
async function setupOwnerWithOrg(t: ReturnType<typeof convexTest>) {
  const { userId, authed } = await setupUser(t, 'Owner');
  const orgId = await authed.mutation(api.organizations.create, {
    name: 'Test Org',
    slug: 'test-org',
  });
  return { userId, authed, orgId };
}

describe('repos.list', () => {
  it('returns repos for the specified org', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    await authed.mutation(api.repos.create, {
      name: 'repo-1',
      path: '/tmp/repo-1',
      orgId,
    });
    await authed.mutation(api.repos.create, {
      name: 'repo-2',
      path: '/tmp/repo-2',
      orgId,
    });

    const repos = await authed.query(api.repos.list, { orgId });
    expect(repos).toHaveLength(2);
    expect(repos.map((r) => r.name).sort()).toEqual(['repo-1', 'repo-2']);
  });

  it('does not return repos from other orgs', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    await authed.mutation(api.repos.create, {
      name: 'my-repo',
      path: '/tmp/my-repo',
      orgId,
    });

    // Create another org + repo as a different user
    const { authed: other, orgId: otherOrgId } = await (async () => {
      const { authed: otherAuthed } = await setupUser(t, 'Other');
      const otherOrgId = await otherAuthed.mutation(api.organizations.create, {
        name: 'Other Org',
        slug: 'other-org',
      });
      return { authed: otherAuthed, orgId: otherOrgId };
    })();

    await other.mutation(api.repos.create, {
      name: 'other-repo',
      path: '/tmp/other-repo',
      orgId: otherOrgId,
    });

    const repos = await authed.query(api.repos.list, { orgId });
    expect(repos).toHaveLength(1);
    expect(repos[0]?.name).toBe('my-repo');
  });

  it('requires membership to list', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);
    const { authed: outsider } = await setupUser(t, 'Outsider');

    await expect(outsider.query(api.repos.list, { orgId })).rejects.toThrow(
      'Not a member of this organization',
    );
  });
});

describe('repos.create', () => {
  it('creates a repo with orgId', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const repoId = await authed.mutation(api.repos.create, {
      name: 'new-repo',
      path: '/tmp/new-repo',
      orgId,
    });

    const repo = await authed.query(api.repos.get, { id: repoId });
    expect(repo).toMatchObject({
      name: 'new-repo',
      path: '/tmp/new-repo',
      orgId,
    });
  });

  it('requires member role', async () => {
    const t = convexTest(schema);
    const { orgId } = await setupOwnerWithOrg(t);
    const { userId: viewerId, authed: viewer } = await setupUser(t, 'Viewer');

    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: viewerId,
        orgId,
        role: 'viewer',
      });
    });

    await expect(
      viewer.mutation(api.repos.create, {
        name: 'repo',
        path: '/tmp/repo',
        orgId,
      }),
    ).rejects.toThrow('Requires member role or higher');
  });

  it('rejects duplicate paths', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    await authed.mutation(api.repos.create, {
      name: 'repo',
      path: '/tmp/same-path',
      orgId,
    });

    await expect(
      authed.mutation(api.repos.create, {
        name: 'repo2',
        path: '/tmp/same-path',
        orgId,
      }),
    ).rejects.toThrow('Repo already exists at /tmp/same-path');
  });
});

describe('repos.remove', () => {
  it('cascades deletion to tasks and sessions', async () => {
    const t = convexTest(schema);
    const { authed, orgId } = await setupOwnerWithOrg(t);

    const repoId = await authed.mutation(api.repos.create, {
      name: 'repo',
      path: '/tmp/repo',
      orgId,
    });

    const taskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Task',
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

    await authed.mutation(api.repos.remove, { id: repoId });

    const repos = await authed.query(api.repos.list, { orgId });
    expect(repos).toHaveLength(0);

    // Tasks should be gone
    const tasks = await t.run(async (ctx) => {
      return await ctx.db.query('tasks').collect();
    });
    expect(tasks).toHaveLength(0);

    // Sessions should be gone
    const sessions = await t.run(async (ctx) => {
      return await ctx.db.query('sessions').collect();
    });
    expect(sessions).toHaveLength(0);
  });

  it('requires admin role to remove', async () => {
    const t = convexTest(schema);
    const { authed: owner, orgId } = await setupOwnerWithOrg(t);
    const { userId: memberId, authed: member } = await setupUser(t, 'Member');

    await t.run(async (ctx) => {
      await ctx.db.insert('memberships', {
        userId: memberId,
        orgId,
        role: 'member',
      });
    });

    const repoId = await owner.mutation(api.repos.create, {
      name: 'repo',
      path: '/tmp/repo',
      orgId,
    });

    await expect(
      member.mutation(api.repos.remove, { id: repoId }),
    ).rejects.toThrow('Requires admin role or higher');
  });
});
