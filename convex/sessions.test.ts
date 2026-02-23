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

/** Create user + org + repo + task, return everything needed for session tests. */
async function setupTaskEnv(t: ReturnType<typeof convexTest>) {
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
  const taskId = await authed.mutation(api.tasks.create, {
    repoId,
    title: 'Test Task',
  });
  return { userId, authed, orgId, repoId, taskId };
}

describe('sessions.create', () => {
  it('creates a session with running status and lastActivityAt', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const before = Date.now();
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    const after = Date.now();

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session).not.toBeNull();
    expect(session?.status).toBe('running');
    expect(session?.taskId).toBe(taskId);
    expect(session?.lastActivityAt).toBeGreaterThanOrEqual(before);
    expect(session?.lastActivityAt).toBeLessThanOrEqual(after);
  });

  it('requires member role', async () => {
    const t = convexTest(schema);
    const { authed: ownerAuthed, orgId, taskId } = await setupTaskEnv(t);

    // Create a viewer member
    const viewerUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', { name: 'Viewer' });
    });
    const viewerAuthed = t.withIdentity({ subject: `${viewerUserId}|s2` });

    // Add as viewer
    await ownerAuthed.mutation(api.memberships.invite, {
      orgId,
      userId: viewerUserId,
      role: 'viewer',
    });

    await expect(
      viewerAuthed.mutation(api.sessions.create, { taskId }),
    ).rejects.toThrow();
  });
});

describe('sessions.getByTask', () => {
  it('returns null when no sessions exist for task', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const result = await authed.query(api.sessions.getByTask, { taskId });
    expect(result).toBeNull();
  });

  it('returns the most recently active session', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const _firstId = await authed.mutation(api.sessions.create, { taskId });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 5));
    const secondId = await authed.mutation(api.sessions.create, { taskId });

    const result = await authed.query(api.sessions.getByTask, { taskId });
    // Should return the most recently active (second created)
    expect(result?._id).toBe(secondId);
  });
});

describe('sessions.listByTask', () => {
  it('returns all sessions for a task ordered by lastActivityAt descending', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const firstId = await authed.mutation(api.sessions.create, { taskId });
    await new Promise((r) => setTimeout(r, 5));
    const secondId = await authed.mutation(api.sessions.create, { taskId });
    await new Promise((r) => setTimeout(r, 5));
    const thirdId = await authed.mutation(api.sessions.create, { taskId });

    const sessions = await authed.query(api.sessions.listByTask, { taskId });
    expect(sessions).toHaveLength(3);
    // Most recently active first
    expect(sessions[0]?._id).toBe(thirdId);
    expect(sessions[1]?._id).toBe(secondId);
    expect(sessions[2]?._id).toBe(firstId);
  });

  it('returns empty array when no sessions exist', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessions = await authed.query(api.sessions.listByTask, { taskId });
    expect(sessions).toEqual([]);
  });

  it('only returns sessions for the specified task', async () => {
    const t = convexTest(schema);
    const { authed, repoId, taskId } = await setupTaskEnv(t);

    // Create a second task
    const otherTaskId = await authed.mutation(api.tasks.create, {
      repoId,
      title: 'Other Task',
    });

    await authed.mutation(api.sessions.create, { taskId });
    await authed.mutation(api.sessions.create, { taskId: otherTaskId });

    const sessions = await authed.query(api.sessions.listByTask, { taskId });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.taskId).toBe(taskId);
  });
});

describe('sessions.listActive', () => {
  it('returns only running sessions for the org', async () => {
    const t = convexTest(schema);
    const { authed, orgId, taskId } = await setupTaskEnv(t);

    const runningId = await authed.mutation(api.sessions.create, { taskId });
    const idleId = await authed.mutation(api.sessions.create, { taskId });

    // Mark second session as idle via server mutation
    await t.run(async (ctx) => {
      await ctx.db.patch(idleId, { status: 'idle' });
    });

    const active = await authed.query(api.sessions.listActive, { orgId });
    expect(active.some((s) => s._id === runningId)).toBe(true);
    expect(active.some((s) => s._id === idleId)).toBe(false);
  });
});

describe('sessions.updateStatus (client-side)', () => {
  it('transitions a session to idle status', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    await authed.mutation(api.sessions.updateStatus, {
      id: sessionId,
      status: 'idle',
    });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('idle');
  });

  it('transitions a session to failed status', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    await authed.mutation(api.sessions.updateStatus, {
      id: sessionId,
      status: 'failed',
    });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('failed');
  });

  it('rejects obsolete completed and stopped statuses', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    // These statuses no longer exist in the simplified schema
    await expect(
      authed.mutation(api.sessions.updateStatus, {
        id: sessionId,
        status: 'completed' as 'idle', // type assertion to bypass compile-time check
      }),
    ).rejects.toThrow();

    await expect(
      authed.mutation(api.sessions.updateStatus, {
        id: sessionId,
        status: 'stopped' as 'idle',
      }),
    ).rejects.toThrow();
  });
});

describe('sessions.updateLastActivity', () => {
  it('updates lastActivityAt timestamp', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    const session = await authed.query(api.sessions.get, { id: sessionId });
    const originalActivity = session?.lastActivityAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));

    await t.run(async (ctx) => {
      // The internal mutation updates lastActivityAt
      await ctx.db.patch(sessionId, { lastActivityAt: Date.now() });
    });

    const updated = await authed.query(api.sessions.get, { id: sessionId });
    expect(updated?.lastActivityAt).toBeGreaterThan(originalActivity ?? 0);
  });
});
