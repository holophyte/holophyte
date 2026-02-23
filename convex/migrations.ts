import { internalMutation } from './_generated/server';

/**
 * Backfill existing session records for the session-rethink migration:
 * - Add `lastActivityAt` (set to `endedAt ?? startedAt`)
 * - Migrate status: 'completed' → 'idle', 'stopped' → 'idle'
 *
 * Run once via Convex dashboard or CLI:
 *   npx convex run migrations:backfillSessions
 */
export const backfillSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const sessions = await ctx.db.query('sessions').collect();
    let updated = 0;

    for (const session of sessions) {
      const patches: Record<string, unknown> = {};

      // Backfill lastActivityAt
      if (session.lastActivityAt === undefined) {
        patches.lastActivityAt = session.endedAt ?? session.startedAt;
      }

      // Migrate old statuses to 'idle'
      const status = session.status as string;
      if (status === 'completed' || status === 'stopped') {
        patches.status = 'idle';
      }

      if (Object.keys(patches).length > 0) {
        await ctx.db.patch(session._id, patches);
        updated++;
      }
    }

    return { total: sessions.length, updated };
  },
});
