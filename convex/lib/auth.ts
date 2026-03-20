import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const ROLE_LEVELS: Record<Doc<'memberships'>['role'], number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Returns true when ALLOW_ANONYMOUS_AUTH is set on the Convex deployment.
 * Used to skip org-scoping in companion functions for local dev where the
 * browser and companion may be separate anonymous users in separate orgs.
 */
export function isLocalDevMode(): boolean {
  return process.env.ALLOW_ANONYMOUS_AUTH === '1';
}

/** Returns userId or throws — use in mutations/queries that require auth. */
export async function requireAuth(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error('Not authenticated');
  return userId;
}

/** Returns userId + membership or throws — verifies user belongs to org. */
export async function requireOrgMembership(
  ctx: QueryCtx | MutationCtx,
  orgId: Id<'organizations'>,
) {
  const userId = await requireAuth(ctx);
  const membership = await ctx.db
    .query('memberships')
    .withIndex('by_user_org', (q) => q.eq('userId', userId).eq('orgId', orgId))
    .first();
  if (!membership) throw new Error('Not a member of this organization');
  return { userId, membership };
}

/** Throws if the membership role is below the required minimum. */
export function requireRole(
  membership: Doc<'memberships'>,
  minRole: 'viewer' | 'member' | 'admin' | 'owner',
) {
  if (ROLE_LEVELS[membership.role] < ROLE_LEVELS[minRole]) {
    throw new Error(`Requires ${minRole} role or higher`);
  }
}

/** Returns the set of org IDs the authenticated user belongs to. */
export async function getUserOrgIds(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
): Promise<Set<Id<'organizations'>>> {
  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  return new Set(memberships.map((m) => m.orgId));
}

/** Resolve orgId from a task ID via its repo. */
export async function getOrgIdFromTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<'tasks'>,
) {
  const task = await ctx.db.get(taskId);
  if (!task) throw new Error('Task not found');
  const repo = await ctx.db.get(task.repoId);
  if (!repo) throw new Error('Repo not found');
  return repo.orgId;
}

/**
 * Verifies the authenticated user owns the session (via session → task → repo → org)
 * and has at least the specified role. Defaults to `member` to match browser-side
 * mutation access controls.
 *
 * Throws if the session doesn't exist, the user isn't a member of its org,
 * or their role is below `minRole`.
 */
export async function requireSessionOwnership(
  ctx: QueryCtx | MutationCtx,
  sessionId: Id<'sessions'>,
  minRole: 'viewer' | 'member' | 'admin' | 'owner' = 'member',
) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error('Session not found');
  const orgId = await getOrgIdFromTask(ctx, session.taskId);
  const { userId, membership } = await requireOrgMembership(ctx, orgId);
  requireRole(membership, minRole);
  return { userId, membership, session };
}

/**
 * Returns org IDs where the user has at least the specified role.
 * Defaults to `member` — excludes `viewer`-only memberships.
 */
export async function getUserWritableOrgIds(
  ctx: QueryCtx | MutationCtx,
  userId: Id<'users'>,
  minRole: 'viewer' | 'member' | 'admin' | 'owner' = 'member',
): Promise<Set<Id<'organizations'>>> {
  const memberships = await ctx.db
    .query('memberships')
    .withIndex('by_user', (q) => q.eq('userId', userId))
    .collect();
  return new Set(
    memberships
      .filter((m) => ROLE_LEVELS[m.role] >= ROLE_LEVELS[minRole])
      .map((m) => m.orgId),
  );
}
