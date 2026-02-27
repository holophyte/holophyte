import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

/**
 * Every minute, reap sessions stuck in `queued` or `stopped` status beyond
 * QUEUED_SESSION_TIMEOUT_MS (10 minutes).
 *
 * - `queued` → `failed`: companion never came online to pick them up.
 * - `stopped` → `idle`: stop was never processed; no process to kill.
 *
 * Threshold matches `src/constants.ts` — keep in sync.
 */
crons.interval(
  'reap stale sessions',
  { minutes: 1 },
  internal.sessions.reapStaleSessions,
);

export default crons;
