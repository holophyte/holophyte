import { internalMutation } from './_generated/server';

/**
 * One-time migration to backfill orgId/createdBy/userId on existing records
 * that predate the multi-tenancy schema.
 *
 * Usage:
 *   bunx convex run --component migrations:backfillOrgOwnership
 *   — or via Convex dashboard → Functions → migrations:backfillOrgOwnership
 *
 * After running, tighten the 5 optional fields in schema.ts back to required
 * and redeploy.
 */
export const backfillOrgOwnership = internalMutation({
  args: {},
  handler: async (ctx) => {
    // Find the first user
    const user = await ctx.db.query('users').first();
    if (!user) return { status: 'no_users', patched: 0 };

    // Find their org membership (prefer personal org)
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', user._id))
      .collect();
    if (memberships.length === 0)
      return { status: 'no_memberships', patched: 0 };

    // Prefer the personal org, fall back to first org
    let orgId = memberships[0]!.orgId;
    for (const m of memberships) {
      const org = await ctx.db.get(m.orgId);
      if (org?.personal) {
        orgId = m.orgId;
        break;
      }
    }

    let patched = 0;

    // Backfill repos.orgId
    const repos = await ctx.db.query('repos').collect();
    for (const repo of repos) {
      if (!repo.orgId) {
        await ctx.db.patch(repo._id, { orgId });
        patched++;
      }
    }

    // Backfill labels.orgId
    const labels = await ctx.db.query('labels').collect();
    for (const label of labels) {
      if (!label.orgId) {
        await ctx.db.patch(label._id, { orgId });
        patched++;
      }
    }

    // Backfill seeds.orgId
    const seeds = await ctx.db.query('seeds').collect();
    for (const seed of seeds) {
      if (!seed.orgId) {
        await ctx.db.patch(seed._id, { orgId });
        patched++;
      }
    }

    // Backfill tasks.createdBy
    const tasks = await ctx.db.query('tasks').collect();
    for (const task of tasks) {
      if (!task.createdBy) {
        await ctx.db.patch(task._id, { createdBy: user._id });
        patched++;
      }
    }

    // Backfill promptTemplates.userId
    const templates = await ctx.db.query('promptTemplates').collect();
    for (const template of templates) {
      if (!template.userId) {
        await ctx.db.patch(template._id, { userId: user._id });
        patched++;
      }
    }

    return { status: 'ok', patched, orgId, userId: user._id };
  },
});
