// ── Companion polling ────────────────────────────────────────────────

import { hostname } from 'node:os';
import { getActiveSessions } from '@/claude/manager';
import type { TokenFileData } from './auth-token';
import { readTokenFile } from './auth-token';
import { callConvexInternal, queryConvexInternal } from './convex-client';
import {
  isSubscriptionsActive,
  startCompanionSubscriptions,
  stopCompanionSubscriptions,
} from './subscriptions';

export interface QueuedSession {
  _id: string;
  queuedPrompt?: string;
  sdkSessionId?: string;
  model?: string;
  permissionMode?: string;
  repoPath: string;
}

export interface StoppedSession {
  _id: string;
}

export interface PendingMessage {
  _id: string;
  sessionId: string;
  text: string;
}

const MACHINE_ID = process.env.MACHINE_ID ?? hostname();
export const POLL_INTERVAL_MS = 2000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;
let companionUrl: string | undefined;
let cachedTokenFile: TokenFileData | null | undefined;

export async function companionPoll() {
  if (polling) return; // Skip if previous poll is still running
  polling = true;

  try {
    // 1. Send heartbeat for all active sessions
    const activeIds = getActiveSessions();
    if (activeIds.length > 0) {
      try {
        await callConvexInternal('/api/internal/sessions/batchHeartbeat', {
          sessionIds: activeIds,
        });
      } catch (err) {
        console.error('Failed to send batch heartbeat:', err);
      }
    }

    // 2. Retry subscription setup if not active (startup failure or subscription error).
    // stopCompanionSubscriptions() is called first so an errored-but-non-null client
    // doesn't block the startCompanionSubscriptions guard check.
    if (!isSubscriptionsActive()) {
      const convexUrl = process.env.CONVEX_URL;
      const secret = process.env.INTERNAL_API_SECRET;
      if (convexUrl && secret) {
        try {
          stopCompanionSubscriptions();
          // Re-read token file in case tokens were rotated since startup
          cachedTokenFile = await readTokenFile();
          await startCompanionSubscriptions({
            convexUrl,
            secret,
            tokenFile: cachedTokenFile,
          });
        } catch {
          // Best-effort — will retry on next poll cycle
        }
      }
    }

    // 3. Send companion-level heartbeat (every cycle, even with zero sessions)
    try {
      await callConvexInternal('/api/internal/companion/heartbeat', {
        activeSessionCount: activeIds.length,
        machineId: MACHINE_ID,
        url: companionUrl,
      });
    } catch {
      // Best-effort — don't log every failure
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
  companionUrl = undefined;
}

// How recently a companion heartbeat must be to indicate an active instance.
const DUPLICATE_THRESHOLD_MS = 10_000;

/**
 * Full companion startup sequence:
 *   1. Detect duplicate instances (exit if another companion is active)
 *   2. Clean up stale/stopped sessions from a prior crash
 *   3. Start the polling loop
 *
 * All Convex calls are non-fatal — missing config is silently skipped.
 */
export async function startCompanion(url: string): Promise<void> {
  // 1. Duplicate check
  // Note: this is an advisory check — two companions starting simultaneously
  // within POLL_INTERVAL_MS of each other can both pass before either has
  // written its first heartbeat (TOCTOU). This is acceptable; the window is
  // narrow and the scenario is unlikely in practice.
  try {
    const status = await queryConvexInternal<{
      lastSeen: number;
      machineId?: string;
    } | null>('/api/internal/companion/status', {});
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

  // 2. Clean up sessions left in inconsistent states from a prior crash or
  //    companion outage:
  //      - 'running' → 'idle': process died without finalising the turn
  //      - 'stopped' → 'idle': stop request was never processed
  try {
    await callConvexInternal('/api/internal/sessions/markStaleRunning', {});
  } catch {
    // Non-critical — Convex may not be configured yet
  }
  try {
    await callConvexInternal('/api/internal/sessions/markStoppedAsIdle', {});
  } catch {
    // Non-critical — Convex may not be configured yet
  }

  // 3. Load user auth token (from `holophyte setup`)
  cachedTokenFile = await readTokenFile();
  if (cachedTokenFile) {
    console.log('Loaded user auth token from', '~/.holophyte/token.json');
  }

  // 4. Start reactive subscriptions for queued/stopped sessions and pending messages
  const convexUrl = process.env.CONVEX_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (convexUrl && secret) {
    try {
      await startCompanionSubscriptions({
        convexUrl,
        secret,
        tokenFile: cachedTokenFile,
      });
    } catch (err) {
      console.error('Failed to start companion subscriptions:', err);
    }
  } else {
    console.error(
      'CONVEX_URL or INTERNAL_API_SECRET not set — companion subscriptions unavailable, sessions will not be reactive',
    );
  }

  // 5. Start the polling loop (heartbeats only)
  startCompanionPolling({ url });
}
