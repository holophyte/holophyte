// ── Companion polling ────────────────────────────────────────────────

import { hostname } from 'node:os';
import { getActiveSessions } from '@/claude/manager';
import type { TokenFileData } from './auth-token';
import { readTokenFile, signInAnonymous } from './auth-token';
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
let heartbeatFailureLogged = false;
// Tracks when an ephemeral token was last cleared after a subscription failure.
// Prevents creating a new anonymous identity every 2s poll cycle during outages,
// while still allowing replacement after a cooldown (e.g. Convex restart).
// At most 2 new identities per 30s window: the one cleared on first failure
// and a replacement obtained on the next cycle, kept for the rest of the window.
let ephemeralClearedAt: number | null = null;
const EPHEMERAL_CLEAR_COOLDOWN_MS = 30_000;

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
      if (convexUrl) {
        try {
          stopCompanionSubscriptions();
          // Re-read token file in case tokens were rotated since startup.
          // If we already have an in-memory token (e.g. anonymous), keep it
          // to avoid creating a new anonymous identity every retry cycle.
          if (!cachedTokenFile?.ephemeral) {
            cachedTokenFile = await readTokenFile();
          }
          if (!cachedTokenFile && process.env.ALLOW_ANONYMOUS_AUTH === '1') {
            cachedTokenFile = await signInAnonymous(convexUrl);
          }
          if (cachedTokenFile) {
            try {
              await startCompanionSubscriptions({
                convexUrl,
                tokenFile: cachedTokenFile,
              });
              ephemeralClearedAt = null;
            } catch (subErr) {
              // Clear stale ephemeral tokens so the next cycle can obtain a
              // fresh anonymous identity (e.g. after a Convex restart).
              // Cooldown prevents creating a new identity every 2s poll cycle
              // during sustained outages — at most 2 per 30s window (the
              // cleared token plus its replacement on the next cycle).
              if (cachedTokenFile.ephemeral) {
                const now = Date.now();
                if (
                  !ephemeralClearedAt ||
                  now - ephemeralClearedAt > EPHEMERAL_CLEAR_COOLDOWN_MS
                ) {
                  cachedTokenFile = null;
                  ephemeralClearedAt = now;
                }
              }
              throw subErr;
            }
          }
        } catch (err) {
          console.error('Failed to restart companion subscriptions:', err);
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
      heartbeatFailureLogged = false;
    } catch (err) {
      if (!heartbeatFailureLogged) {
        heartbeatFailureLogged = true;
        console.error('Companion heartbeat failed:', err);
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
  companionUrl = undefined;
  cachedTokenFile = undefined;
  heartbeatFailureLogged = false;
  ephemeralClearedAt = null;
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

  // If no token file, try anonymous auth (local dev / E2E)
  const convexUrl = process.env.CONVEX_URL;
  if (
    !cachedTokenFile &&
    process.env.ALLOW_ANONYMOUS_AUTH === '1' &&
    convexUrl
  ) {
    cachedTokenFile = await signInAnonymous(convexUrl);
    if (cachedTokenFile) {
      console.log('Companion authenticated anonymously (local dev mode)');
    }
  }

  // 4. Start reactive subscriptions for queued/stopped sessions and pending messages
  if (convexUrl && cachedTokenFile) {
    try {
      await startCompanionSubscriptions({
        convexUrl,
        tokenFile: cachedTokenFile,
      });
    } catch (err) {
      console.error('Failed to start companion subscriptions:', err);
    }
  } else if (!convexUrl) {
    console.error(
      'CONVEX_URL not set — companion subscriptions unavailable, sessions will not be reactive',
    );
  } else if (process.env.ALLOW_ANONYMOUS_AUTH === '1') {
    console.error(
      'No auth token found and anonymous sign-in failed — check that the Convex deployment has an anonymous provider configured.',
    );
  } else {
    console.error(
      'No auth token found — run `bun run setup` to authenticate. Subscriptions will retry when a token is available.',
    );
  }

  // 5. Start the polling loop (heartbeats only)
  startCompanionPolling({ url });
}
