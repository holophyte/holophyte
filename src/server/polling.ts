// ── Companion polling ────────────────────────────────────────────────

import { hostname } from 'node:os';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getActiveSessions } from '@/claude/manager';
import type { TokenFileData } from './auth-token';
import { readTokenFile } from './auth-token';
import {
  closeCompanionClients,
  getConvexClient,
  getConvexHttpClient,
  initCompanionClients,
} from './convex-client';
import {
  isSubscriptionsActive,
  startCompanionSubscriptions,
  stopCompanionSubscriptions,
} from './subscriptions';

export interface QueuedSession {
  _id: Id<'sessions'>;
  queuedPrompt?: string;
  sdkSessionId?: string;
  model?: string;
  permissionMode?: string;
  repoPath: string;
}

export interface StoppedSession {
  _id: Id<'sessions'>;
}

export interface PendingMessage {
  _id: Id<'sessionMessages'>;
  sessionId: Id<'sessions'>;
  text: string;
}

const MACHINE_ID = process.env.MACHINE_ID ?? hostname();
export const POLL_INTERVAL_MS = 2000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let companionUrl: string | undefined;
let cachedTokenFile: TokenFileData | null | undefined;
let heartbeatFailureLogged = false;

export async function companionPoll() {
  if (polling) return; // Skip if previous poll is still running
  polling = true;

  try {
    const client = getConvexClient();

    // 1. Send heartbeat for all active sessions
    if (client) {
      const activeIds = getActiveSessions();
      if (activeIds.length > 0) {
        try {
          await client.mutation(api.sessions.companionBatchHeartbeat, {
            sessionIds: activeIds as Id<'sessions'>[],
          });
        } catch (err) {
          console.error('Failed to send batch heartbeat:', err);
        }
      }
    }

    // 2. Retry subscription setup if not active (startup failure or subscription error).
    // stopCompanionSubscriptions() is called first so errored subscriptions
    // don't block the startCompanionSubscriptions guard check.
    if (!isSubscriptionsActive()) {
      const convexUrl = process.env.CONVEX_URL;
      if (convexUrl) {
        try {
          stopCompanionSubscriptions();
          closeCompanionClients();
          // Re-read token file in case tokens were rotated since startup
          cachedTokenFile = await readTokenFile();
          if (cachedTokenFile) {
            initCompanionClients(convexUrl, cachedTokenFile);
            await startCompanionSubscriptions();
          }
        } catch (err) {
          console.error('Failed to restart companion subscriptions:', err);
        }
      }
    }

    // 3. Send companion-level heartbeat (every cycle, even with zero sessions)
    // Re-fetch client — step 2 may have closed and re-created it.
    const heartbeatClient = getConvexClient();
    if (heartbeatClient) {
      try {
        await heartbeatClient.mutation(api.companion.companionHeartbeat, {
          activeSessionCount: getActiveSessions().length,
          machineId: MACHINE_ID,
          url: companionUrl,
        });
        heartbeatFailureLogged = false;
      } catch (err) {
        if (!heartbeatFailureLogged) {
          heartbeatFailureLogged = true;
          console.error('Companion heartbeat failed:', err);
        }
      }
    }
  } catch (err) {
    // Don't log transient failures (noisy during startup or when Convex is unavailable)
    const msg = String(err);
    if (msg.includes('not set') || msg.includes('ConnectionRefused')) return;
    console.error('Companion poll error:', err);
  } finally {
    polling = false;
  }
}

export function startCompanionPolling(opts?: { url?: string }) {
  if (pollTimer) return;
  if (opts?.url) companionUrl = opts.url;
  pollTimer = setInterval(companionPoll, POLL_INTERVAL_MS);
  // Run immediately on start
  void companionPoll();
}

export function stopCompanionPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopCompanionSubscriptions();
  closeCompanionClients();
  companionUrl = undefined;
  heartbeatFailureLogged = false;
}

// How recently a companion heartbeat must be to indicate an active instance.
const DUPLICATE_THRESHOLD_MS = 10_000;

/**
 * Full companion startup sequence:
 *   1. Load user auth token
 *   2. Initialize authenticated Convex clients
 *   3. Detect duplicate instances (exit if another companion is active)
 *   4. Clean up stale/stopped sessions from a prior crash
 *   5. Start reactive subscriptions
 *   6. Start the polling loop
 *
 * All Convex calls are non-fatal — missing config is silently skipped.
 */
export async function startCompanion(url: string): Promise<void> {
  // 1. Load user auth token (from `holophyte setup`)
  cachedTokenFile = await readTokenFile();
  if (cachedTokenFile) {
    console.log('Loaded user auth token from', '~/.holophyte/token.json');
  }

  // 2. Initialize authenticated Convex clients
  const convexUrl = process.env.CONVEX_URL;
  if (convexUrl && cachedTokenFile) {
    try {
      initCompanionClients(convexUrl, cachedTokenFile);
    } catch (err) {
      console.error('Failed to initialize Convex clients:', err);
    }
  } else if (!convexUrl) {
    console.error(
      'CONVEX_URL not set — companion subscriptions unavailable, sessions will not be reactive',
    );
  } else {
    console.error(
      'No auth token found — run `bun run setup` to authenticate. Subscriptions will retry when a token is available.',
    );
  }

  // 3. Duplicate check
  // Note: this is an advisory check — two companions starting simultaneously
  // within POLL_INTERVAL_MS of each other can both pass before either has
  // written its first heartbeat (TOCTOU). This is acceptable; the window is
  // narrow and the scenario is unlikely in practice.
  const httpClient = getConvexHttpClient();
  if (httpClient) {
    try {
      const status = await httpClient.query(api.companion.companionGetStatus);
      const now = Date.now();
      if (
        status &&
        now - status.lastSeen < DUPLICATE_THRESHOLD_MS &&
        status.machineId !== MACHINE_ID
      ) {
        const secondsAgo = Math.round((now - status.lastSeen) / 1000);
        console.error(
          `Error: Another companion is already connected to this deployment (last seen ${secondsAgo}s ago).\n` +
            `Stop it first, or check your CONVEX_DEPLOYMENT config.`,
        );
        process.exit(1);
      }
    } catch {
      // Skip if Convex is not configured yet
    }
  }

  // 4. Clean up sessions left in inconsistent states from a prior crash
  const client = getConvexClient();
  if (client) {
    try {
      await client.mutation(api.sessions.companionMarkStaleRunning, {});
    } catch {
      // Non-critical — Convex may not be configured yet
    }
    try {
      await client.mutation(api.sessions.companionMarkStoppedAsIdle, {});
    } catch {
      // Non-critical — Convex may not be configured yet
    }
  }

  // 5. Start reactive subscriptions for queued/stopped sessions and pending messages
  if (getConvexClient()) {
    try {
      await startCompanionSubscriptions();
    } catch (err) {
      console.error('Failed to start companion subscriptions:', err);
    }
  }

  // 6. Start the polling loop (heartbeats only)
  startCompanionPolling({ url });
}
