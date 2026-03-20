// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api, internal } from './_generated/api';
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
  it('creates a session with queued status and lastActivityAt', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const before = Date.now();
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    const after = Date.now();

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session).not.toBeNull();
    expect(session?.status).toBe('queued');
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

    // create() now sets 'queued' — transition first session to 'running'
    // and second to 'idle' to test the listActive filter.
    await t.run(async (ctx) => {
      await ctx.db.patch(runningId, { status: 'running' });
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

describe('sessions.requestStop', () => {
  it('stops a running session', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    await authed.mutation(api.sessions.requestStop, { id: sessionId });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('stopped');
  });

  it('stops a queued session', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    // create() already sets 'queued', no patch needed

    await authed.mutation(api.sessions.requestStop, { id: sessionId });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('stopped');
  });

  it('no-ops when session is idle', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'idle' });
    });

    await authed.mutation(api.sessions.requestStop, { id: sessionId });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('idle');
  });

  it('no-ops when session is already stopped', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'stopped' });
    });

    await authed.mutation(api.sessions.requestStop, { id: sessionId });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('stopped');
  });

  it('no-ops when session is failed', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'failed' });
    });

    await authed.mutation(api.sessions.requestStop, { id: sessionId });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('failed');
  });

  it('requires member role', async () => {
    const t = convexTest(schema);
    const { authed: ownerAuthed, orgId, taskId } = await setupTaskEnv(t);

    const sessionId = await ownerAuthed.mutation(api.sessions.create, {
      taskId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    // Create a viewer
    const viewerUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', { name: 'Viewer' });
    });
    const viewerAuthed = t.withIdentity({ subject: `${viewerUserId}|s2` });
    await ownerAuthed.mutation(api.memberships.invite, {
      orgId,
      userId: viewerUserId,
      role: 'viewer',
    });

    await expect(
      viewerAuthed.mutation(api.sessions.requestStop, { id: sessionId }),
    ).rejects.toThrow();
  });
});

describe('sessions.queueResume', () => {
  it('resumes an idle session → queued with queuedPrompt set', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'idle' });
    });

    const result = await authed.mutation(api.sessions.queueResume, {
      id: sessionId,
      prompt: 'Continue the task',
    });
    expect(result).toEqual({ ok: true });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('queued');
    expect(session?.queuedPrompt).toBe('Continue the task');
  });

  it('returns { ok: false } when session is not idle', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    const result = await authed.mutation(api.sessions.queueResume, {
      id: sessionId,
      prompt: 'Continue',
    });
    expect(result).toEqual({ ok: false });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('running');
  });

  it('requires member role', async () => {
    const t = convexTest(schema);
    const { authed: ownerAuthed, orgId, taskId } = await setupTaskEnv(t);

    const sessionId = await ownerAuthed.mutation(api.sessions.create, {
      taskId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'idle' });
    });

    // Create a viewer
    const viewerUserId = await t.run(async (ctx) => {
      return await ctx.db.insert('users', { name: 'Viewer' });
    });
    const viewerAuthed = t.withIdentity({ subject: `${viewerUserId}|s2` });
    await ownerAuthed.mutation(api.memberships.invite, {
      orgId,
      userId: viewerUserId,
      role: 'viewer',
    });

    await expect(
      viewerAuthed.mutation(api.sessions.queueResume, {
        id: sessionId,
        prompt: 'Continue',
      }),
    ).rejects.toThrow();
  });
});

describe('sessions.listQueued', () => {
  it('returns queued sessions with repoPath enriched', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    // create() sets status to 'queued' — no patch needed

    const queued = await t.query(internal.sessions.listQueued, {});
    expect(queued).toHaveLength(1);
    expect(queued[0]?._id).toBe(sessionId);
    expect(queued[0]?.repoPath).toBe('/tmp/test-repo');
  });

  it('excludes non-queued sessions', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    const queued = await t.query(internal.sessions.listQueued, {});
    expect(queued).toHaveLength(0);
  });

  it('skips orphaned sessions (missing task/repo)', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    // Delete the task to orphan the session
    await t.run(async (ctx) => {
      await ctx.db.delete(taskId);
    });

    const queued = await t.query(internal.sessions.listQueued, {});
    // The session is queued but its task is gone — should be skipped
    expect(queued.every((s) => s._id !== sessionId)).toBe(true);
  });
});

describe('sessions.claimQueued', () => {
  it('claims a queued session → running', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    const result = await t.mutation(internal.sessions.claimQueued, {
      id: sessionId,
    });
    expect(result).toEqual({ ok: true });

    const session = await authed.query(api.sessions.get, { id: sessionId });
    expect(session?.status).toBe('running');
  });

  it('returns { ok: false } if session is no longer queued', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    const result = await t.mutation(internal.sessions.claimQueued, {
      id: sessionId,
    });
    expect(result).toEqual({ ok: false });
  });

  it('returns { ok: false } for nonexistent session', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create a session just to get a valid-format ID, then delete it
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.delete(sessionId);
    });

    const result = await t.mutation(internal.sessions.claimQueued, {
      id: sessionId,
    });
    expect(result).toEqual({ ok: false });
  });
});

describe('sessions.listStopped', () => {
  it('returns only stopped sessions', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const stoppedId = await authed.mutation(api.sessions.create, { taskId });
    const runningId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(stoppedId, { status: 'stopped' });
      await ctx.db.patch(runningId, { status: 'running' });
    });

    const stopped = await t.query(internal.sessions.listStopped, {});
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?._id).toBe(stoppedId);
  });

  it('returns empty array when none exist', async () => {
    const t = convexTest(schema);

    const stopped = await t.query(internal.sessions.listStopped, {});
    expect(stopped).toEqual([]);
  });
});

describe('sessions.reapStaleSessions', () => {
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  it('marks queued sessions older than 10 minutes as failed', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    // Insert a stale queued session directly (older than timeout)
    const staleTime = Date.now() - TEN_MINUTES_MS - 1000;
    const staleSessionId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: staleTime,
        lastActivityAt: staleTime,
      });
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(1);

    const session = await t.run(async (ctx) => ctx.db.get(staleSessionId));
    expect(session?.status).toBe('failed');
  });

  it('does NOT reap queued sessions within the timeout window', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    // Insert a fresh queued session (just now)
    const freshSessionId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(0);

    const session = await t.run(async (ctx) => ctx.db.get(freshSessionId));
    expect(session?.status).toBe('queued');
  });

  it('reaps only the stale sessions and leaves recent ones intact', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const staleTime = Date.now() - TEN_MINUTES_MS - 5000;
    const recentTime = Date.now() - 1000;

    const [staleId, recentId] = await t.run(async (ctx) => {
      const stale = await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: staleTime,
        lastActivityAt: staleTime,
      });
      const recent = await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: recentTime,
        lastActivityAt: recentTime,
      });
      return [stale, recent] as const;
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(1);

    const [stale, recent] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(staleId), ctx.db.get(recentId)]),
    );
    expect(stale?.status).toBe('failed');
    expect(recent?.status).toBe('queued');
  });

  it('does not reap non-queued/non-stopped sessions (running, idle, failed)', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const staleTime = Date.now() - TEN_MINUTES_MS - 5000;

    await t.run(async (ctx) => {
      for (const status of ['running', 'idle', 'failed'] as const) {
        await ctx.db.insert('sessions', {
          taskId,
          status,
          startedAt: staleTime,
          lastActivityAt: staleTime,
        });
      }
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(0);
  });

  it('returns count 0 when there are no queued sessions', async () => {
    const t = convexTest(schema);

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(0);
  });

  it('uses lastActivityAt over startedAt to determine staleness', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    // startedAt is old but lastActivityAt is recent — should NOT be reaped
    const oldStart = Date.now() - TEN_MINUTES_MS - 5000;
    const recentActivity = Date.now() - 1000;

    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: oldStart,
        lastActivityAt: recentActivity,
      });
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(0);

    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session?.status).toBe('queued');
  });

  it('marks stopped sessions older than 10 minutes as idle', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const staleTime = Date.now() - TEN_MINUTES_MS - 1000;
    const staleStoppedId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'stopped',
        startedAt: staleTime,
        lastActivityAt: staleTime,
      });
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(1);

    const session = await t.run(async (ctx) => ctx.db.get(staleStoppedId));
    expect(session?.status).toBe('idle');
  });

  it('does NOT reap stopped sessions within the timeout window', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const recentStoppedId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'stopped',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.sessions.reapStaleSessions, {});
    expect(result.count).toBe(0);

    const session = await t.run(async (ctx) => ctx.db.get(recentStoppedId));
    expect(session?.status).toBe('stopped');
  });
});

describe('sessions.companionListQueued', () => {
  it('returns queued sessions when authenticated', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });

    const queued = await authed.query(api.sessions.companionListQueued, {});
    expect(queued).toHaveLength(1);
    expect(queued[0]?._id).toBe(sessionId);
    expect(queued[0]?.repoPath).toBe('/tmp/test-repo');
  });

  it('throws when unauthenticated', async () => {
    const t = convexTest(schema);

    await expect(t.query(api.sessions.companionListQueued, {})).rejects.toThrow(
      'Not authenticated',
    );
  });

  it('does not return sessions from other orgs', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create a session in the owner's org
    await authed.mutation(api.sessions.create, { taskId });

    // Create a second user with their own org
    const { authed: otherAuthed } = await setupUser(t, 'Other User');
    const otherOrgId = await otherAuthed.mutation(api.organizations.create, {
      name: 'Other Org',
      slug: 'other-org',
    });
    const otherRepoId = await otherAuthed.mutation(api.repos.create, {
      name: 'other-repo',
      path: '/tmp/other-repo',
      orgId: otherOrgId,
    });
    const otherTaskId = await otherAuthed.mutation(api.tasks.create, {
      repoId: otherRepoId,
      title: 'Other Task',
    });
    await otherAuthed.mutation(api.sessions.create, { taskId: otherTaskId });

    // Other user should only see their own org's sessions
    const queued = await otherAuthed.query(
      api.sessions.companionListQueued,
      {},
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]?.repoPath).toBe('/tmp/other-repo');
  });
});

describe('sessions.companionListStopped', () => {
  it('returns stopped sessions when authenticated', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'stopped' });
    });

    const stopped = await authed.query(api.sessions.companionListStopped, {});
    expect(stopped).toHaveLength(1);
    expect(stopped[0]?._id).toBe(sessionId);
  });

  it('throws when unauthenticated', async () => {
    const t = convexTest(schema);

    await expect(
      t.query(api.sessions.companionListStopped, {}),
    ).rejects.toThrow('Not authenticated');
  });

  it('does not return sessions from other orgs', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create a stopped session in owner's org
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'stopped' });
    });

    // Create a second user with their own org — no sessions
    const { authed: otherAuthed } = await setupUser(t, 'Other User');
    await otherAuthed.mutation(api.organizations.create, {
      name: 'Other Org',
      slug: 'other-org',
    });

    // Other user should see no stopped sessions (they're in a different org)
    const stopped = await otherAuthed.query(
      api.sessions.companionListStopped,
      {},
    );
    expect(stopped).toHaveLength(0);
  });
});

describe('sessions.serverMarkStoppedAsIdle', () => {
  it('transitions all stopped sessions to idle on startup', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const [stopped1, stopped2] = await t.run(async (ctx) => {
      const s1 = await ctx.db.insert('sessions', {
        taskId,
        status: 'stopped',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const s2 = await ctx.db.insert('sessions', {
        taskId,
        status: 'stopped',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return [s1, s2] as const;
    });

    const result = await t.mutation(
      internal.sessions.serverMarkStoppedAsIdle,
      {},
    );
    expect(result.count).toBe(2);

    const [s1, s2] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(stopped1), ctx.db.get(stopped2)]),
    );
    expect(s1?.status).toBe('idle');
    expect(s2?.status).toBe('idle');
  });

  it('does not affect non-stopped sessions', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    const [queuedId, runningId, idleId] = await t.run(async (ctx) => {
      const q = await ctx.db.insert('sessions', {
        taskId,
        status: 'queued',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const r = await ctx.db.insert('sessions', {
        taskId,
        status: 'running',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      const i = await ctx.db.insert('sessions', {
        taskId,
        status: 'idle',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      return [q, r, i] as const;
    });

    const result = await t.mutation(
      internal.sessions.serverMarkStoppedAsIdle,
      {},
    );
    expect(result.count).toBe(0);

    const [queued, running, idle] = await t.run(async (ctx) =>
      Promise.all([
        ctx.db.get(queuedId),
        ctx.db.get(runningId),
        ctx.db.get(idleId),
      ]),
    );
    expect(queued?.status).toBe('queued');
    expect(running?.status).toBe('running');
    expect(idle?.status).toBe('idle');
  });

  it('returns count 0 when there are no stopped sessions', async () => {
    const t = convexTest(schema);

    const result = await t.mutation(
      internal.sessions.serverMarkStoppedAsIdle,
      {},
    );
    expect(result.count).toBe(0);
  });
});

describe('sessions.listActive — org isolation', () => {
  it('returns only sessions for the queried org, not other orgs', async () => {
    const t = convexTest(schema);
    const { authed, orgId, taskId } = await setupTaskEnv(t);

    // Create a running session in org 1
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    // Create a second user with their own org and a running session
    const { authed: otherAuthed } = await setupUser(t, 'Other User');
    const otherOrgId = await otherAuthed.mutation(api.organizations.create, {
      name: 'Other Org',
      slug: 'other-org',
    });
    const otherRepoId = await otherAuthed.mutation(api.repos.create, {
      name: 'other-repo',
      path: '/tmp/other-repo',
      orgId: otherOrgId,
    });
    const otherTaskId = await otherAuthed.mutation(api.tasks.create, {
      repoId: otherRepoId,
      title: 'Other Task',
    });
    const otherSessionId = await otherAuthed.mutation(api.sessions.create, {
      taskId: otherTaskId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(otherSessionId, { status: 'running' });
    });

    // Org 1 should only see its own session
    const active = await authed.query(api.sessions.listActive, { orgId });
    expect(active).toHaveLength(1);
    expect(active[0]?._id).toBe(sessionId);

    // Org 2 should only see its own session
    const otherActive = await otherAuthed.query(api.sessions.listActive, {
      orgId: otherOrgId,
    });
    expect(otherActive).toHaveLength(1);
    expect(otherActive[0]?._id).toBe(otherSessionId);
  });
});

describe('sessions.companionMarkStaleRunning — org isolation', () => {
  it('only transitions running sessions in the caller orgs', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create running session in org 1
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    // Create running session in org 2 (different user)
    const { authed: otherAuthed } = await setupUser(t, 'Other User');
    const otherOrgId = await otherAuthed.mutation(api.organizations.create, {
      name: 'Other Org',
      slug: 'other-org-2',
    });
    const otherRepoId = await otherAuthed.mutation(api.repos.create, {
      name: 'other-repo-2',
      path: '/tmp/other-repo-2',
      orgId: otherOrgId,
    });
    const otherTaskId = await otherAuthed.mutation(api.tasks.create, {
      repoId: otherRepoId,
      title: 'Other Task',
    });
    const otherSessionId = await otherAuthed.mutation(api.sessions.create, {
      taskId: otherTaskId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(otherSessionId, { status: 'running' });
    });

    // Only mark stale for org 1's user — should only affect org 1 session
    const result = await authed.mutation(
      api.sessions.companionMarkStaleRunning,
      {},
    );
    expect(result.count).toBe(1);

    const [s1, s2] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(sessionId), ctx.db.get(otherSessionId)]),
    );
    expect(s1?.status).toBe('idle');
    expect(s2?.status).toBe('running'); // not touched
  });
});

describe('sessions.companionMarkStoppedAsIdle — org isolation', () => {
  it('only transitions stopped sessions in the caller orgs', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create stopped session in org 1
    const sessionId = await authed.mutation(api.sessions.create, { taskId });
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'stopped' });
    });

    // Create stopped session in org 2 (different user)
    const { authed: otherAuthed } = await setupUser(t, 'Other User');
    const otherOrgId = await otherAuthed.mutation(api.organizations.create, {
      name: 'Other Org',
      slug: 'other-org-3',
    });
    const otherRepoId = await otherAuthed.mutation(api.repos.create, {
      name: 'other-repo-3',
      path: '/tmp/other-repo-3',
      orgId: otherOrgId,
    });
    const otherTaskId = await otherAuthed.mutation(api.tasks.create, {
      repoId: otherRepoId,
      title: 'Other Task',
    });
    const otherSessionId = await otherAuthed.mutation(api.sessions.create, {
      taskId: otherTaskId,
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(otherSessionId, { status: 'stopped' });
    });

    // Only mark stopped as idle for org 1's user — should only affect org 1 session
    const result = await authed.mutation(
      api.sessions.companionMarkStoppedAsIdle,
      {},
    );
    expect(result.count).toBe(1);

    const [s1, s2] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(sessionId), ctx.db.get(otherSessionId)]),
    );
    expect(s1?.status).toBe('idle');
    expect(s2?.status).toBe('stopped'); // not touched
  });
});

describe('sessions.backfillOrgId', () => {
  it('patches sessions missing orgId via task→repo join', async () => {
    const t = convexTest(schema);
    const { taskId, orgId } = await setupTaskEnv(t);

    // Insert a session without orgId (simulates pre-denorm document)
    const sessionId = await t.run(async (ctx) => {
      return await ctx.db.insert('sessions', {
        taskId,
        status: 'idle',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
    });

    const result = await t.mutation(internal.sessions.backfillOrgId, {});
    expect(result.patched).toBe(1);
    expect(result.isDone).toBe(true);

    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session?.orgId).toBe(orgId);
  });

  it('skips sessions that already have orgId (idempotent)', async () => {
    const t = convexTest(schema);
    const { authed, taskId } = await setupTaskEnv(t);

    // Create via mutation (already has orgId)
    await authed.mutation(api.sessions.create, { taskId });

    const result = await t.mutation(internal.sessions.backfillOrgId, {});
    expect(result.patched).toBe(0);
    expect(result.isDone).toBe(true);
  });

  it('skips orphaned sessions gracefully (task deleted)', async () => {
    const t = convexTest(schema);
    const { taskId } = await setupTaskEnv(t);

    // Insert session without orgId, then delete the task
    const sessionId = await t.run(async (ctx) => {
      const id = await ctx.db.insert('sessions', {
        taskId,
        status: 'idle',
        startedAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      await ctx.db.delete(taskId);
      return id;
    });

    // Should not throw — just skip the orphaned session
    const result = await t.mutation(internal.sessions.backfillOrgId, {});
    expect(result.patched).toBe(0);
    expect(result.isDone).toBe(true);

    // Session still exists but has no orgId (was orphaned)
    const session = await t.run(async (ctx) => ctx.db.get(sessionId));
    expect(session?.orgId).toBeUndefined();
  });

  it('returns isDone true and continueCursor null when finished', async () => {
    const t = convexTest(schema);

    const result = await t.mutation(internal.sessions.backfillOrgId, {});
    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBeNull();
  });
});
