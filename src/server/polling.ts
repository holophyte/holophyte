// ── Companion polling ────────────────────────────────────────────────

import { hostname } from 'node:os';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getActiveSessions } from '@/claude/manager';
import type { TokenFileData } from './auth-token';
import { readTokenFile, signInAnonymous } from './auth-token';
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
const INSTANCE_ID = `${MACHINE_ID}:${process.pid}`;
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

function getDeployment(): string | undefined {
  return process.env.CONVEX_DEPLOYMENT;
}

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
      const deployment = getDeployment();
      if (convexUrl) {
        try {
          stopCompanionSubscriptions();
          closeCompanionClients();
          // Re-read token file in case tokens were rotated since startup.
          // If we already have an in-memory token (e.g. anonymous), keep it
          // to avoid creating a new anonymous identity every retry cycle.
          let tokenStatus: 'missing' | 'invalid' | 'ok' = cachedTokenFile
            ? 'ok'
            : 'missing';
          if (!cachedTokenFile?.ephemeral && deployment) {
            const result = await readTokenFile(deployment);
            tokenStatus = result.status;
            cachedTokenFile = result.status === 'ok' ? result.data : null;
            if (result.status === 'invalid') {
              console.error(
                `Token file invalid for ${deployment}: ${result.reason}`,
              );
            }
          }
          // Only fall back to anonymous auth when the token is missing, not
          // when it's invalid (corrupt token should surface as an error).
          if (
            tokenStatus === 'missing' &&
            !cachedTokenFile &&
            process.env.ALLOW_ANONYMOUS_AUTH === '1'
          ) {
            cachedTokenFile = await signInAnonymous(convexUrl);
          }
          // Ephemeral tokens don't need a deployment key (never persisted).
          if (cachedTokenFile && (deployment || cachedTokenFile.ephemeral)) {
            try {
              initCompanionClients(
                convexUrl,
                cachedTokenFile,
                deployment ?? '',
              );
              await startCompanionSubscriptions();
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
    // Re-fetch client — step 2 may have closed and re-created it.
    const heartbeatClient = getConvexClient();
    if (heartbeatClient) {
      try {
        await heartbeatClient.mutation(api.companion.companionHeartbeat, {
          activeSessionCount: getActiveSessions().length,
          machineId: MACHINE_ID,
          instanceId: INSTANCE_ID,
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
  cachedTokenFile = undefined;
  heartbeatFailureLogged = false;
  ephemeralClearedAt = null;
}

// How recently a companion heartbeat must be to indicate an active instance.
const DUPLICATE_THRESHOLD_MS = 10_000;

/**
 * Checks whether the process behind a stale heartbeat is still alive.
 * On the same machine, uses `process.kill(pid, 0)` to probe the PID.
 * Cross-machine heartbeats are always treated as alive (can't probe remotely).
 */
function isInstanceAlive(instanceId: string): boolean {
  const separatorIdx = instanceId.lastIndexOf(':');
  if (separatorIdx === -1) return true; // Malformed — assume alive
  const staleHost = instanceId.slice(0, separatorIdx);
  const stalePid = Number(instanceId.slice(separatorIdx + 1));
  if (Number.isNaN(stalePid)) return true; // Malformed — assume alive

  // Different machine — can't check, assume alive
  if (staleHost !== MACHINE_ID) return true;

  // Same machine — check if the PID is still running
  try {
    process.kill(stalePid, 0);
    return true; // Process exists
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return false; // Process definitively gone
    }
    return true; // EPERM or other — process likely still alive
  }
}

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
  const deployment = getDeployment();

  // 1. Load user auth token (from `holophyte setup`)
  let tokenStatus: 'missing' | 'invalid' | 'ok' = 'missing';
  if (deployment) {
    const result = await readTokenFile(deployment);
    tokenStatus = result.status;
    if (result.status === 'ok') {
      cachedTokenFile = result.data;
      console.log(`Loaded user auth token for deployment ${deployment}`);
    } else if (result.status === 'invalid') {
      console.error(`Token file invalid for ${deployment}: ${result.reason}`);
    }
  } else {
    console.error(
      'CONVEX_DEPLOYMENT not set — cannot read deployment-specific token',
    );
  }

  // Anonymous auth fallback (still part of step 1 — obtaining a token)
  // Only fall back when the token is missing, not when it's corrupt.
  const convexUrl = process.env.CONVEX_URL;
  if (
    tokenStatus === 'missing' &&
    !cachedTokenFile &&
    process.env.ALLOW_ANONYMOUS_AUTH === '1' &&
    convexUrl
  ) {
    cachedTokenFile = await signInAnonymous(convexUrl);
    if (cachedTokenFile) {
      console.log('Companion authenticated anonymously (local dev mode)');
    }
  }

  // 2. Initialize authenticated Convex clients
  // Ephemeral tokens don't need a deployment key (never persisted to disk).
  if (
    convexUrl &&
    cachedTokenFile &&
    (deployment || cachedTokenFile.ephemeral)
  ) {
    try {
      initCompanionClients(convexUrl, cachedTokenFile, deployment ?? '');
    } catch (err) {
      console.error('Failed to initialize Convex clients:', err);
    }
  } else if (!convexUrl) {
    console.error(
      'CONVEX_URL not set — companion subscriptions unavailable, sessions will not be reactive',
    );
  } else if (!deployment && !cachedTokenFile?.ephemeral) {
    console.error(
      'CONVEX_DEPLOYMENT not set — companion cannot authenticate. Ensure convex dev is running.',
    );
  } else if (process.env.ALLOW_ANONYMOUS_AUTH === '1') {
    console.error(
      'No auth token found and anonymous sign-in failed — ensure the anonymous provider is configured on your Convex deployment.',
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
  const httpClient = await getConvexHttpClient();
  if (httpClient) {
    try {
      const status = await httpClient.query(api.companion.companionGetStatus);
      const now = Date.now();
      if (
        status &&
        now - status.lastSeen < DUPLICATE_THRESHOLD_MS &&
        status.instanceId !== undefined &&
        status.instanceId !== INSTANCE_ID &&
        isInstanceAlive(status.instanceId)
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
