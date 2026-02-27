/** Default Claude model used when launching a new session. */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * How long a session may remain in `queued` status before the Convex cron
 * reaps it as `failed`. 10 minutes gives ample time for the companion to come
 * online, but prevents orphaned sessions from accumulating indefinitely.
 */
export const QUEUED_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How long a queued session must wait before the frontend shows a warning
 * banner. Keeps the UI quiet for the first 30 seconds (companion is usually
 * online within one or two poll cycles).
 */
export const QUEUED_WARNING_THRESHOLD_MS = 30 * 1000; // 30 seconds
