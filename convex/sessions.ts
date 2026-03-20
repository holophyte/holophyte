import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server';
import {
  getUserOrgIds,
  getUserWritableOrgIds,
  requireAuth,
  requireOrgMembership,
  requireRole,
  requireSessionOwnership,
} from './lib/auth';
import { sessionStatusValidator } from './schema';

/**
 * Returns all currently running sessions scoped to an org.
 *
 * Uses the `by_org_status` compound index for a direct org+status lookup,
 * eliminating the previous full scan + N join. Requires org membership.
 */
export const listActive = query({
  args: { orgId: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.orgId);
    return await ctx.db
      .query('sessions')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', args.orgId).eq('status', 'running'),
      )
      .collect();
  },
});

/**
 * Returns the global count of currently running sessions (across all orgs).
 *
 * Used by the server to enforce the concurrent session cap before spawning a
 * new SDK process. No auth check — callers on the server trust this value.
 */
export const countActive = internalQuery({
  args: {},
  handler: async (ctx) => {
    const runningSessions = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'running'))
      .collect();
    return runningSessions.length;
  },
});

/**
 * Returns a single session by ID, or `null` if not found.
 * Verifies that the caller is a member of the session's parent org.
 */
export const get = query({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) return null;
    const task = await ctx.db.get(session.taskId);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return null;
    await requireOrgMembership(ctx, repo.orgId);
    return session;
  },
});

/**
 * Returns the most recently active session for a task, or `null` if none exist.
 *
 * Uses the `by_task_activity` index ordered descending so the first result is
 * always the session with the highest `lastActivityAt`. Requires org membership.
 */
export const getByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return null;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return null;
    await requireOrgMembership(ctx, repo.orgId);
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_task_activity', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .first();
    return sessions ?? null;
  },
});

/**
 * Returns all sessions for a task, ordered by `lastActivityAt` descending
 * (most recently active first).
 *
 * Used by the session dropdown to show the full session history. Returns an
 * empty array when the task doesn't exist (rather than null), so callers can
 * always render without a null-check. Requires org membership.
 */
export const listByTask = query({
  args: { taskId: v.id('tasks') },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return [];
    const repo = await ctx.db.get(task.repoId);
    if (!repo) return [];
    await requireOrgMembership(ctx, repo.orgId);
    return await ctx.db
      .query('sessions')
      .withIndex('by_task_activity', (q) => q.eq('taskId', args.taskId))
      .order('desc')
      .collect();
  },
});

/**
 * Creates a new session record in `queued` status and returns its ID.
 *
 * The companion server polls for queued sessions and picks them up to start
 * the SDK process. Accepts optional model, permissionMode, and prompt so the
 * companion has everything it needs to launch.
 *
 * Initialises both `startedAt` and `lastActivityAt` to the current timestamp.
 * Requires at least `member` role in the task's org.
 */
export const create = mutation({
  args: {
    taskId: v.id('tasks'),
    prompt: v.optional(v.string()),
    model: v.optional(v.string()),
    permissionMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    const now = Date.now();
    return await ctx.db.insert('sessions', {
      taskId: args.taskId,
      orgId: repo.orgId,
      status: 'queued',
      startedAt: now,
      lastActivityAt: now,
      queuedPrompt: args.prompt,
      model: args.model,
      permissionMode: args.permissionMode,
    });
  },
});

/**
 * Updates the status of a session and bumps `lastActivityAt`.
 *
 * Valid transitions: `running → idle | failed`. Requires at least `member`
 * role in the session's parent org. Called from the frontend (e.g. stop button).
 */
export const updateStatus = mutation({
  args: {
    id: v.id('sessions'),
    status: sessionStatusValidator,
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');
    await ctx.db.patch(args.id, {
      status: args.status,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Atomically transitions an idle session to `running` for resume.
 *
 * Guards against the race condition where two browser tabs attempt to resume
 * the same session simultaneously: the first caller wins and the second gets
 * `{ ok: false }` instead of a thrown error, so the frontend can handle it
 * gracefully without surfacing an error boundary.
 *
 * Requires at least `member` role in the session's parent org.
 *
 * @returns `{ ok: true }` if the transition succeeded, `{ ok: false }` if the
 *   session was not in `idle` status (i.e. another tab already resumed it).
 */
export const resumeSession = mutation({
  args: {
    id: v.id('sessions'),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');

    // Atomic guard: only transition from idle → running
    if (session.status !== 'idle') {
      return { ok: false };
    }

    await ctx.db.patch(args.id, {
      status: 'running',
      lastActivityAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Requests that the companion stop a running session.
 *
 * Sets the session status to `stopped` — a signal for the companion to abort
 * the SDK process. The companion will then transition the session to `idle`
 * (resumable) once cleanup completes. Requires at least `member` role.
 */
export const requestStop = mutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');

    // Only stop sessions that are running or queued
    if (session.status !== 'running' && session.status !== 'queued') {
      return;
    }

    await ctx.db.patch(args.id, {
      status: 'stopped',
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Queues an idle session for resume by setting status to `queued` with a new
 * prompt. The companion picks it up and starts the SDK with the existing
 * `sdkSessionId` for conversation continuity.
 *
 * Guards against the race condition where two browser tabs attempt to resume
 * the same session simultaneously.
 *
 * Requires at least `member` role in the session's parent org.
 *
 * @returns `{ ok: true }` if the transition succeeded, `{ ok: false }` if the
 *   session was not in `idle` status.
 */
export const queueResume = mutation({
  args: {
    id: v.id('sessions'),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    const { membership } = await requireOrgMembership(ctx, repo.orgId);
    requireRole(membership, 'member');

    if (session.status !== 'idle') {
      return { ok: false };
    }

    await ctx.db.patch(args.id, {
      status: 'queued',
      queuedPrompt: args.prompt,
      lastActivityAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Bumps `lastActivityAt` to the current time.
 *
 * Called from the frontend when the user sends a message, so the session list
 * sort order stays accurate even before the server processes the turn. Requires
 * org membership (any role).
 */
export const updateLastActivity = mutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const task = await ctx.db.get(session.taskId);
    if (!task) throw new Error('Task not found');
    const repo = await ctx.db.get(task.repoId);
    if (!repo) throw new Error('Repo not found');
    await requireOrgMembership(ctx, repo.orgId);
    await ctx.db.patch(args.id, { lastActivityAt: Date.now() });
  },
});

/**
 * Persists the SDK session ID returned by the `system/init` event, along with
 * the model and permission mode used for this turn.
 *
 * The `sdkSessionId` is the key used to resume a session in a future turn via
 * `sdkOptions.resume`. Stored here so it survives a server restart or process
 * exit. Internal — called only by the Bun server via HTTP action.
 */
export const updateSdkSessionId = internalMutation({
  args: {
    id: v.id('sessions'),
    sdkSessionId: v.string(),
    model: v.optional(v.string()),
    permissionMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    const updates: Record<string, unknown> = {
      sdkSessionId: args.sdkSessionId,
    };
    if (args.model !== undefined) updates.model = args.model;
    if (args.permissionMode !== undefined)
      updates.permissionMode = args.permissionMode;
    await ctx.db.patch(args.id, updates);
  },
});

/**
 * Updates session status and bumps `lastActivityAt`.
 *
 * Called by the Bun server at the end of a turn to transition the session to
 * `idle` (success) or `failed` (error). Internal — not callable from the
 * browser. Unlike {@link updateStatus}, skips auth since the server is trusted.
 */
export const serverUpdateStatus = internalMutation({
  args: {
    id: v.id('sessions'),
    status: sessionStatusValidator,
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, {
      status: args.status,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Bumps `lastActivityAt` without changing status.
 *
 * Called by the Bun server after each `assistant` or `result` SDK event so the
 * session list sort order in the UI updates reactively while a turn is in
 * progress. Internal — not callable from the browser.
 */
export const serverUpdateActivity = internalMutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, { lastActivityAt: Date.now() });
  },
});

/**
 * Marks all sessions that are still in `stopped` status as `idle`.
 *
 * Called once on server startup to clean up stop requests that were never
 * processed (e.g. the companion was offline when the user clicked Stop).
 * There is no active SDK process to abort, so transitioning directly to `idle`
 * is correct. Internal — not callable from the browser.
 *
 * @returns `{ count }` — number of sessions transitioned.
 */
export const serverMarkStoppedAsIdle = internalMutation({
  args: {},
  handler: async (ctx) =>
    transitionSessions(ctx, {
      fromStatus: 'stopped',
      toStatus: 'idle',
      lastActivityAt: () => Date.now(),
    }),
});

/**
 * Marks all sessions that are still in `running` status as `idle`.
 *
 * Called once on server startup to recover from a crash or restart where the
 * server process died before it could transition sessions to `idle` or
 * `failed`. Sessions left as `running` with no active backend process are
 * effectively stale — resetting them to `idle` lets users resume or start
 * fresh. Internal — not callable from the browser.
 */
export const serverMarkStaleRunning = internalMutation({
  args: {},
  handler: async (ctx) =>
    transitionSessions(ctx, {
      fromStatus: 'running',
      toStatus: 'idle',
      lastActivityAt: (s) => s.lastActivityAt ?? s.startedAt,
    }),
});

/**
 * Sets the human-readable display name for a session.
 *
 * Called by the Bun server at session start with the first 30 characters of
 * the prompt (plus an ellipsis if truncated). Future: overwritten when haiku
 * generates a richer name after the first turn. Internal — not callable from
 * the browser.
 */
export const serverUpdateName = internalMutation({
  args: {
    id: v.id('sessions'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session) throw new Error('Session not found');
    await ctx.db.patch(args.id, { name: args.name });
  },
});

/**
 * Shared implementation for listQueued and companionListQueued.
 * When `orgIds` is provided, queries by_org_status per org to avoid a full
 * table scan + N+1 join. Without orgIds (internal callers), uses by_status.
 */
async function fetchQueuedSessions(
  ctx: QueryCtx,
  orgIds?: Set<Id<'organizations'>>,
) {
  const sessions = orgIds
    ? await collectByOrgs(ctx, orgIds, 'queued')
    : await ctx.db
        .query('sessions')
        .withIndex('by_status', (q) => q.eq('status', 'queued'))
        .collect();

  const result = [];
  for (const session of sessions) {
    const task = await ctx.db.get(session.taskId);
    if (!task) continue;
    const repo = await ctx.db.get(task.repoId);
    if (!repo) continue;
    result.push({ ...session, repoPath: repo.path });
  }
  return result;
}

/**
 * Returns all sessions with status `queued`, enriched with the repo path
 * needed by the companion to launch the SDK process.
 *
 * Internal — called by the companion's polling loop.
 */
export const listQueued = internalQuery({
  args: {},
  handler: async (ctx) => {
    return fetchQueuedSessions(ctx);
  },
});

/**
 * Atomically transitions a queued session to `running`.
 *
 * Returns `{ ok: true }` if claimed successfully, `{ ok: false }` if the
 * session was no longer in `queued` status (e.g. cancelled by user).
 *
 * Internal — called by the companion after finding a queued session.
 */
export const claimQueued = internalMutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.id);
    if (!session || session.status !== 'queued') return { ok: false };
    await ctx.db.patch(args.id, {
      status: 'running',
      lastActivityAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Reaps sessions stuck in `queued` or `stopped` status beyond the timeout.
 *
 * - `queued` → `failed`: the companion never came online to pick them up.
 * - `stopped` → `idle`: the user clicked Stop but the companion never processed
 *   it, so there is no active SDK process to abort. Transitioning to `idle`
 *   (rather than `failed`) preserves the resumable history.
 *
 * Threshold: 10 minutes (matches `QUEUED_SESSION_TIMEOUT_MS` in
 * `src/constants.ts` — keep in sync). Called by the Convex cron in
 * `convex/crons.ts` every minute. Internal — not callable from the browser.
 *
 * @returns `{ count }` — total number of sessions transitioned.
 */
export const reapStaleSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    // 10 minutes — must match QUEUED_SESSION_TIMEOUT_MS in src/constants.ts
    const QUEUED_TIMEOUT_MS = 10 * 60 * 1000;
    const cutoff = Date.now() - QUEUED_TIMEOUT_MS;
    const now = Date.now();
    let count = 0;

    // Stale queued sessions → failed (companion was never available)
    const queued = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'queued'))
      .collect();
    for (const session of queued) {
      if ((session.lastActivityAt ?? session.startedAt) < cutoff) {
        await ctx.db.patch(session._id, {
          status: 'failed',
          lastActivityAt: now,
        });
        count++;
      }
    }

    // Stale stopped sessions → idle (stop was never processed; no process to kill)
    const stopped = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'stopped'))
      .collect();
    for (const session of stopped) {
      if ((session.lastActivityAt ?? session.startedAt) < cutoff) {
        await ctx.db.patch(session._id, {
          status: 'idle',
          lastActivityAt: now,
        });
        count++;
      }
    }

    return { count };
  },
});

/**
 * Updates `lastHeartbeat` for a batch of active sessions.
 *
 * Called by the companion's polling loop every 2 seconds to signal that the
 * process is alive and managing these sessions. The frontend uses the
 * heartbeat to derive `companionOnline`. Internal — not callable from the
 * browser.
 */
export const serverBatchHeartbeat = internalMutation({
  args: { sessionIds: v.array(v.id('sessions')) },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const id of args.sessionIds) {
      const session = await ctx.db.get(id);
      if (session) {
        await ctx.db.patch(id, { lastHeartbeat: now });
      }
    }
  },
});

/**
 * Returns all sessions with status `stopped`.
 *
 * The companion checks this to detect user-initiated stop requests and abort
 * the corresponding SDK processes. Internal — not callable from the browser.
 */
export const listStopped = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', 'stopped'))
      .collect();
  },
});

/**
 * Public companion query: returns queued sessions with repoPath.
 *
 * Accessible to the companion via ConvexClient subscriptions. Requires JWT
 * authentication via `ConvexClient.setAuth()` — the companion obtains a
 * session token during `holophyte setup`.
 *
 * Scoped to the authenticated user's orgs — the companion can only see
 * sessions for orgs it is a member of.
 */
export const companionListQueued = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    return fetchQueuedSessions(ctx, orgIds);
  },
});

/**
 * Public companion query: returns `_id` for all sessions with status `stopped`.
 *
 * Accessible to the companion via ConvexClient subscriptions. Returns only
 * `_id` to minimise data in transit. Requires JWT authentication.
 *
 * Scoped to the authenticated user's orgs — the companion can only see
 * sessions for orgs it is a member of. Uses by_org_status index to avoid
 * the previous O(N×2) full scan + per-session join pattern.
 */
export const companionListStopped = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserOrgIds(ctx, userId);
    const sessions = await collectByOrgs(ctx, orgIds, 'stopped');
    return sessions.map((s) => ({ _id: s._id }));
  },
});

// ── Shared helpers for internal + companion mutations ────────────────

/**
 * Collects sessions matching `fromStatus`, patches each to `toStatus` with
 * the given `lastActivityAt`. When `orgIds` is provided, uses the compound
 * `by_org_status` index per org; otherwise scans globally via `by_status`.
 */
async function transitionSessions(
  ctx: MutationCtx,
  opts: {
    fromStatus: Doc<'sessions'>['status'];
    toStatus: Doc<'sessions'>['status'];
    lastActivityAt: (session: Doc<'sessions'>) => number;
    orgIds?: Set<Id<'organizations'>>;
  },
): Promise<{ count: number }> {
  const { fromStatus, toStatus, lastActivityAt, orgIds } = opts;
  let count = 0;

  let sessions: Doc<'sessions'>[];
  if (orgIds) {
    // Primary: indexed lookup for sessions with denormalized orgId
    sessions = await collectByOrgs(ctx, orgIds, fromStatus);
    // Fallback: pick up un-backfilled sessions (orgId undefined) via by_status
    // TODO(#170): remove fallback after backfill confirmed complete
    const allByStatus = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', fromStatus))
      .collect();
    const indexedIds = new Set(sessions.map((s) => s._id));
    for (const s of allByStatus) {
      if (indexedIds.has(s._id) || s.orgId) continue;
      const resolvedOrgId = await getOrgIdFromTaskOrNull(ctx, s.taskId);
      if (resolvedOrgId && orgIds.has(resolvedOrgId)) {
        sessions.push(s);
      }
    }
  } else {
    sessions = await ctx.db
      .query('sessions')
      .withIndex('by_status', (q) => q.eq('status', fromStatus))
      .collect();
  }

  for (const session of sessions) {
    await ctx.db.patch(session._id, {
      status: toStatus,
      lastActivityAt: lastActivityAt(session),
    });
    count++;
  }
  return { count };
}

/** Collects sessions across multiple orgs using the compound index. */
async function collectByOrgs(
  ctx: MutationCtx | QueryCtx,
  orgIds: Set<Id<'organizations'>>,
  status: Doc<'sessions'>['status'],
): Promise<Doc<'sessions'>[]> {
  const result: Doc<'sessions'>[] = [];
  for (const orgId of orgIds) {
    const sessions = await ctx.db
      .query('sessions')
      .withIndex('by_org_status', (q) =>
        q.eq('orgId', orgId).eq('status', status),
      )
      .collect();
    result.push(...sessions);
  }
  return result;
}

// ── Public companion mutations (JWT-authenticated via ConvexClient) ──

/**
 * Atomically transitions a queued session to `running`.
 * Public equivalent of {@link claimQueued} — authenticated via JWT.
 */
export const companionClaimQueued = mutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    const { session } = await requireSessionOwnership(ctx, args.id);
    if (session.status !== 'queued') return { ok: false };
    await ctx.db.patch(args.id, {
      status: 'running',
      lastActivityAt: Date.now(),
    });
    return { ok: true };
  },
});

/**
 * Updates session status and bumps `lastActivityAt`.
 * Public equivalent of {@link serverUpdateStatus} — authenticated via JWT.
 */
export const companionUpdateStatus = mutation({
  args: {
    id: v.id('sessions'),
    status: sessionStatusValidator,
  },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.id);
    await ctx.db.patch(args.id, {
      status: args.status,
      lastActivityAt: Date.now(),
    });
  },
});

/**
 * Marks all `running` sessions as `idle` (startup crash recovery).
 * Public equivalent of {@link serverMarkStaleRunning} — scoped to user's orgs.
 */
export const companionMarkStaleRunning = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserWritableOrgIds(ctx, userId);
    return transitionSessions(ctx, {
      fromStatus: 'running',
      toStatus: 'idle',
      lastActivityAt: (s) => s.lastActivityAt ?? s.startedAt,
      orgIds,
    });
  },
});

/**
 * Marks all `stopped` sessions as `idle` (startup cleanup).
 * Public equivalent of {@link serverMarkStoppedAsIdle} — scoped to user's orgs.
 */
export const companionMarkStoppedAsIdle = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserWritableOrgIds(ctx, userId);
    return transitionSessions(ctx, {
      fromStatus: 'stopped',
      toStatus: 'idle',
      lastActivityAt: () => Date.now(),
      orgIds,
    });
  },
});

/**
 * Returns the orgId for a session via task→repo join.
 * Gracefully returns null if the task or repo has been deleted (orphaned session).
 * TODO(#170): remove fallback after backfill confirmed complete.
 */
async function getOrgIdFromTaskOrNull(
  ctx: QueryCtx,
  taskId: Id<'tasks'>,
): Promise<Id<'organizations'> | null> {
  const task = await ctx.db.get(taskId);
  if (!task) return null;
  const repo = await ctx.db.get(task.repoId);
  if (!repo) return null;
  return repo.orgId;
}

/**
 * Updates `lastHeartbeat` for a batch of active sessions.
 * Public equivalent of {@link serverBatchHeartbeat} — authenticated via JWT.
 * Uses denormalized orgId for org check; falls back to task→repo join for
 * un-backfilled sessions.
 */
export const companionBatchHeartbeat = mutation({
  args: { sessionIds: v.array(v.id('sessions')) },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const orgIds = await getUserWritableOrgIds(ctx, userId);
    const now = Date.now();
    for (const id of args.sessionIds) {
      const session = await ctx.db.get(id);
      if (!session) continue;
      // Use denormalized orgId; fallback to join for un-backfilled sessions
      // TODO(#170): remove fallback after backfill confirmed complete
      const sessionOrgId =
        session.orgId ?? (await getOrgIdFromTaskOrNull(ctx, session.taskId));
      if (!sessionOrgId || !orgIds.has(sessionOrgId)) continue;
      await ctx.db.patch(id, { lastHeartbeat: now });
    }
  },
});

/**
 * Persists the SDK session ID, model, and permission mode.
 * Public equivalent of {@link updateSdkSessionId} — authenticated via JWT.
 */
export const companionUpdateSdkSessionId = mutation({
  args: {
    id: v.id('sessions'),
    sdkSessionId: v.string(),
    model: v.optional(v.string()),
    permissionMode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.id);
    await ctx.db.patch(args.id, {
      sdkSessionId: args.sdkSessionId,
      ...(args.model !== undefined && { model: args.model }),
      ...(args.permissionMode !== undefined && {
        permissionMode: args.permissionMode,
      }),
    });
  },
});

/**
 * Bumps `lastActivityAt` without changing status.
 * Public equivalent of {@link serverUpdateActivity} — authenticated via JWT.
 */
export const companionUpdateActivity = mutation({
  args: { id: v.id('sessions') },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.id);
    await ctx.db.patch(args.id, { lastActivityAt: Date.now() });
  },
});

/**
 * Sets the human-readable display name for a session.
 * Public equivalent of {@link serverUpdateName} — authenticated via JWT.
 */
export const companionUpdateName = mutation({
  args: {
    id: v.id('sessions'),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    await requireSessionOwnership(ctx, args.id);
    await ctx.db.patch(args.id, { name: args.name });
  },
});

/**
 * Backfills `orgId` onto existing sessions that were created before the
 * denormalization was added.
 *
 * Pages through all sessions in batches of 500. For each session missing
 * `orgId`, resolves it via `task → repo` and patches. Orphaned sessions
 * (task or repo deleted) are skipped gracefully.
 *
 * Invoke iteratively, passing the returned `continueCursor` back until
 * `isDone` is true:
 * ```
 * let cursor = undefined;
 * do {
 *   const r = await convex.mutation(internal.sessions.backfillOrgId, { cursor });
 *   cursor = r.continueCursor ?? undefined;
 *   console.log(`patched ${r.patched}, done: ${r.isDone}`);
 * } while (!r.isDone);
 * ```
 */
export const backfillOrgId = internalMutation({
  args: { cursor: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const PAGE_SIZE = 500;
    const result = await ctx.db
      .query('sessions')
      .paginate({ numItems: PAGE_SIZE, cursor: args.cursor ?? null });
    let patched = 0;
    for (const session of result.page) {
      if (session.orgId) continue; // already has orgId
      const task = await ctx.db.get(session.taskId);
      if (!task) continue; // orphaned session — skip gracefully
      const repo = await ctx.db.get(task.repoId);
      if (!repo) continue; // orphaned session — skip gracefully
      await ctx.db.patch(session._id, { orgId: repo.orgId });
      patched++;
    }
    return {
      patched,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor,
    };
  },
});
