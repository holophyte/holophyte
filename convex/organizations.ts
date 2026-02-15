import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import { requireAuth, requireOrgMembership, requireRole } from './lib/auth';

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
    const orgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return org ? { ...org, role: m.role } : null;
      }),
    );
    return orgs.filter((o) => o !== null);
  },
});

export const get = query({
  args: { id: v.id('organizations') },
  handler: async (ctx, args) => {
    await requireOrgMembership(ctx, args.id);
    return await ctx.db.get(args.id);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const existing = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (existing) throw new Error('Organization slug already taken');
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(args.slug)) {
      throw new Error(
        'Slug must be lowercase alphanumeric with hyphens, 1-63 characters',
      );
    }
    const orgId = await ctx.db.insert('organizations', {
      name: args.name,
      slug: args.slug,
      personal: false,
    });
    await ctx.db.insert('memberships', {
      userId,
      orgId,
      role: 'owner',
    });
    return orgId;
  },
});

export const createPersonal = internalMutation({
  args: { userId: v.id('users') },
  handler: async (ctx, args) => {
    const slug = `personal-${args.userId}`;
    // Idempotency: return existing personal org if already created
    const existing = await ctx.db
      .query('organizations')
      .withIndex('by_slug', (q) => q.eq('slug', slug))
      .first();
    if (existing) return existing._id;
    const user = await ctx.db.get(args.userId);
    const name = user?.name ?? 'Personal';
    const orgId = await ctx.db.insert('organizations', {
      name,
      slug,
      personal: true,
    });
    await ctx.db.insert('memberships', {
      userId: args.userId,
      orgId,
      role: 'owner',
    });
    return orgId;
  },
});

export const update = mutation({
  args: {
    id: v.id('organizations'),
    name: v.optional(v.string()),
    slug: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { membership } = await requireOrgMembership(ctx, args.id);
    requireRole(membership, 'admin');
    const updates: Record<string, string> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.slug !== undefined) {
      const slug = args.slug;
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
        throw new Error(
          'Slug must be lowercase alphanumeric with hyphens, 1-63 characters',
        );
      }
      const existing = await ctx.db
        .query('organizations')
        .withIndex('by_slug', (q) => q.eq('slug', slug))
        .first();
      if (existing && existing._id !== args.id) {
        throw new Error('Organization slug already taken');
      }
      updates.slug = slug;
    }
    await ctx.db.patch(args.id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id('organizations') },
  handler: async (ctx, args) => {
    const { membership } = await requireOrgMembership(ctx, args.id);
    requireRole(membership, 'owner');

    // Cascade: repos → tasks → sessions/subtasks/promptHistory
    const repos = await ctx.db
      .query('repos')
      .withIndex('by_org', (q) => q.eq('orgId', args.id))
      .collect();
    for (const repo of repos) {
      const tasks = await ctx.db
        .query('tasks')
        .withIndex('by_repo_status', (q) => q.eq('repoId', repo._id))
        .collect();
      for (const task of tasks) {
        const sessions = await ctx.db
          .query('sessions')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .collect();
        for (const session of sessions) await ctx.db.delete(session._id);
        const subtasks = await ctx.db
          .query('subtasks')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .collect();
        for (const subtask of subtasks) await ctx.db.delete(subtask._id);
        const history = await ctx.db
          .query('promptHistory')
          .withIndex('by_task', (q) => q.eq('taskId', task._id))
          .collect();
        for (const entry of history) await ctx.db.delete(entry._id);
        await ctx.db.delete(task._id);
      }
      const templates = await ctx.db
        .query('promptTemplates')
        .withIndex('by_repo', (q) => q.eq('repoId', repo._id))
        .collect();
      for (const tmpl of templates) await ctx.db.delete(tmpl._id);
      await ctx.db.delete(repo._id);
    }

    // Cascade: labels
    const labels = await ctx.db
      .query('labels')
      .withIndex('by_org', (q) => q.eq('orgId', args.id))
      .collect();
    for (const label of labels) await ctx.db.delete(label._id);

    // Cascade: seeds
    const seeds = await ctx.db
      .query('seeds')
      .withIndex('by_org', (q) => q.eq('orgId', args.id))
      .collect();
    for (const seed of seeds) await ctx.db.delete(seed._id);

    // Cascade: memberships
    const memberships = await ctx.db
      .query('memberships')
      .withIndex('by_org', (q) => q.eq('orgId', args.id))
      .collect();
    for (const m of memberships) await ctx.db.delete(m._id);

    await ctx.db.delete(args.id);
  },
});
