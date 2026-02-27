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

/** Create user + org + repo + task + session, return everything needed for message tests. */
async function setupSessionEnv(t: ReturnType<typeof convexTest>) {
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
  const sessionId = await authed.mutation(api.sessions.create, { taskId });
  return { userId, authed, orgId, repoId, taskId, sessionId };
}

describe('sessionMessages.send', () => {
  it('creates a message with consumed: false', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    const msgId = await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Hello session',
    });

    const msg = await t.run(async (ctx) => {
      return await ctx.db.get(msgId);
    });
    expect(msg).not.toBeNull();
    expect(msg?.sessionId).toBe(sessionId);
    expect(msg?.text).toBe('Hello session');
    expect(msg?.consumed).toBe(false);
  });

  it('requires member role', async () => {
    const t = convexTest(schema);
    const { authed: ownerAuthed, orgId, sessionId } = await setupSessionEnv(t);

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
      viewerAuthed.mutation(api.sessionMessages.send, {
        sessionId,
        text: 'Should fail',
      }),
    ).rejects.toThrow();
  });
});

describe('sessionMessages.listPending', () => {
  it('returns unconsumed messages for running sessions', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    // Transition session to running
    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Pending message',
    });

    const pending = await t.query(internal.sessionMessages.listPending, {});
    expect(pending).toHaveLength(1);
    expect(pending[0]?.text).toBe('Pending message');
    expect(pending[0]?.consumed).toBe(false);
  });

  it('excludes consumed messages', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    await t.run(async (ctx) => {
      await ctx.db.patch(sessionId, { status: 'running' });
    });

    const msgId = await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Will be consumed',
    });

    // Mark as consumed
    await t.mutation(internal.sessionMessages.markConsumed, { id: msgId });

    const pending = await t.query(internal.sessionMessages.listPending, {});
    expect(pending).toHaveLength(0);
  });

  it('excludes messages for non-running sessions', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    // Session is in 'queued' status (default from create)
    await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Message for queued session',
    });

    const pending = await t.query(internal.sessionMessages.listPending, {});
    expect(pending).toHaveLength(0);
  });
});

describe('sessionMessages.markConsumed', () => {
  it('sets consumed to true', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    const msgId = await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Mark me consumed',
    });

    await t.mutation(internal.sessionMessages.markConsumed, { id: msgId });

    const msg = await t.run(async (ctx) => {
      return await ctx.db.get(msgId);
    });
    expect(msg?.consumed).toBe(true);
  });

  it('no-ops for nonexistent message ID', async () => {
    const t = convexTest(schema);
    const { authed, sessionId } = await setupSessionEnv(t);

    // Create and delete a message to get a valid-format but nonexistent ID
    const msgId = await authed.mutation(api.sessionMessages.send, {
      sessionId,
      text: 'Temporary',
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(msgId);
    });

    // Should not throw
    await t.mutation(internal.sessionMessages.markConsumed, { id: msgId });
  });
});
