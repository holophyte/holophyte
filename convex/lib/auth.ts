import { getAuthUserId } from '@convex-dev/auth/server';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

const ROLE_LEVELS: Record<Doc<'memberships'>['role'], number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

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
