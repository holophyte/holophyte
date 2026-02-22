import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import { requireAuth } from './lib/auth';

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireAuth(ctx);
    return await ctx.db
      .query('customThemes')
      .withIndex('by_user', (q) => q.eq('userId', userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    colorScheme: v.union(v.literal('light'), v.literal('dark')),
    background: v.string(),
    foreground: v.string(),
    primary: v.string(),
    accent: v.string(),
    ring: v.string(),
    overrides: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    return await ctx.db.insert('customThemes', {
      name: args.name,
      colorScheme: args.colorScheme,
      background: args.background,
      foreground: args.foreground,
      primary: args.primary,
      accent: args.accent,
      ring: args.ring,
      overrides: args.overrides,
      userId,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id('customThemes'),
    name: v.optional(v.string()),
    colorScheme: v.optional(v.union(v.literal('light'), v.literal('dark'))),
    background: v.optional(v.string()),
    foreground: v.optional(v.string()),
    primary: v.optional(v.string()),
    accent: v.optional(v.string()),
    ring: v.optional(v.string()),
    overrides: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const theme = await ctx.db.get(args.id);
    if (!theme) throw new Error('Custom theme not found');
    if (theme.userId !== userId)
      throw new Error('Not authorized to edit this theme');
    const { id, ...fields } = args;
    const updates: Partial<typeof fields> = {};
    if (fields.name !== undefined) updates.name = fields.name;
    if (fields.colorScheme !== undefined)
      updates.colorScheme = fields.colorScheme;
    if (fields.background !== undefined) updates.background = fields.background;
    if (fields.foreground !== undefined) updates.foreground = fields.foreground;
    if (fields.primary !== undefined) updates.primary = fields.primary;
    if (fields.accent !== undefined) updates.accent = fields.accent;
    if (fields.ring !== undefined) updates.ring = fields.ring;
    if (fields.overrides !== undefined) updates.overrides = fields.overrides;
    await ctx.db.patch(id, updates);
  },
});

export const remove = mutation({
  args: { id: v.id('customThemes') },
  handler: async (ctx, args) => {
    const userId = await requireAuth(ctx);
    const theme = await ctx.db.get(args.id);
    if (!theme) throw new Error('Custom theme not found');
    if (theme.userId !== userId)
      throw new Error('Not authorized to delete this theme');
    await ctx.db.delete(args.id);
  },
});
