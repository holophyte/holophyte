// ── Companion subscriptions ──────────────────────────────────────────────
//
// Uses ConvexClient (WebSocket-based) to subscribe to reactive queries
// instead of polling. Fires immediately when data changes.

import { api } from '@convex/_generated/api';
import type { PermissionMode } from '@/claude/manager';
import {
  getSession,
  sendMessageToSession,
  startSession,
  stopSession,
} from '@/claude/manager';
import { getConvexClient } from './convex-client';
import type { PendingMessage, QueuedSession, StoppedSession } from './polling';

let subscriptionsActive = false;
// Incremented by onError callbacks; reset on each fresh startCompanionSubscriptions.
// Allows isSubscriptionsActive() to return false when subscriptions have errored,
// so the retry loop in companionPoll can tear down and reconnect.
let subscriptionErrorCount = 0;
// Incremented each time subscriptions are set up. Captured in each onError
// callback closure so stale callbacks from a closed client don't corrupt the
// error count of a newly started one.
let subscriptionGeneration = 0;
const unsubscribers: Array<() => void> = [];

// Track in-flight operations to avoid double-processing the same item
// when the subscription fires multiple times before an item is claimed/stopped.
// Do NOT clear these sets in stopCompanionSubscriptions — each handler's finally
// block deletes its own ID, so they are self-cleaning. Clearing them while handlers
// are still mid-await would allow re-entry for the same ID on a quick stop/restart.
const inFlightClaims = new Set<string>();
const inFlightStops = new Set<string>();
const inFlightMessages = new Set<string>();

async function handleQueuedSession(session: QueuedSession): Promise<void> {
  if (!session.queuedPrompt) return;
  if (getSession(session._id)) return;
  if (inFlightClaims.has(session._id)) return;

  const client = getConvexClient();
  if (!client) return;

  inFlightClaims.add(session._id);
  try {
    const claimed = await client.mutation(api.sessions.companionClaimQueued, {
      id: session._id,
    });
    if (!claimed.ok) return;

    // Note: any stop request that arrived while claiming was deferred by
    // handleStoppedSession (it skips sessions with in-flight claims). It will
    // be processed on the next subscription re-evaluation once inFlightClaims
    // releases this ID via the finally block below.
    await startSession({
      sessionId: session._id,
      repoPath: session.repoPath,
      prompt: session.queuedPrompt,
      model: session.model,
      permissionMode: session.permissionMode as PermissionMode | undefined,
      resumeSdkSessionId: session.sdkSessionId,
    });
  } catch (err) {
    console.error(`Failed to start queued session ${session._id}:`, err);
    try {
      await client.mutation(api.sessions.companionUpdateStatus, {
        id: session._id,
        status: 'failed',
      });
    } catch {
      // Best-effort
    }
  } finally {
    inFlightClaims.delete(session._id);
  }
}

/** Waits until a session is removed from the local manager map (max 10s). */
async function waitForSessionGone(sessionId: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (!getSession(sessionId)) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  console.error(
    `Session ${sessionId} did not exit within 10s — releasing inFlightStops lock`,
  );
}

async function handleStoppedSession(session: StoppedSession): Promise<void> {
  if (inFlightStops.has(session._id)) return;
  // If a claim is in-flight for this session, skip — once startSession() makes
  // it visible via getSession(), the next subscription re-evaluation will pick
  // up any stop request correctly.
  if (inFlightClaims.has(session._id)) return;

  const client = getConvexClient();

  inFlightStops.add(session._id);
  try {
    if (getSession(session._id)) {
      stopSession(session._id);
      // Hold the lock until the session is cleaned up so that subscription
      // re-evaluations triggered by heartbeats don't call stopSession() again.
      await waitForSessionGone(session._id);
    } else if (client) {
      await client.mutation(api.sessions.companionUpdateStatus, {
        id: session._id,
        status: 'idle',
      });
    }
  } catch (err) {
    console.error(`Failed to stop session ${session._id}:`, err);
  } finally {
    inFlightStops.delete(session._id);
  }
}

async function handlePendingMessage(msg: PendingMessage): Promise<void> {
  if (inFlightMessages.has(msg._id)) return;

  const client = getConvexClient();
  if (!client) return;

  inFlightMessages.add(msg._id);
  try {
    const delivered = sendMessageToSession(msg.sessionId, msg.text);
    if (delivered) {
      await client.mutation(api.sessionMessages.companionMarkConsumed, {
        id: msg._id,
      });
    }
  } catch (err) {
    console.error(`Failed to deliver message ${msg._id}:`, err);
  } finally {
    inFlightMessages.delete(msg._id);
  }
}

/**
 * Sets up reactive subscriptions on the shared ConvexClient.
 *
 * The ConvexClient must already be initialized via `initCompanionClients()`
 * before calling this function.
 */
export async function startCompanionSubscriptions(): Promise<void> {
  const client = getConvexClient();
  if (!client) {
    throw new Error(
      'ConvexClient not initialized — call initCompanionClients() first',
    );
  }
  if (subscriptionsActive) return;
  subscriptionsActive = true; // Claim slot synchronously to block concurrent callers

  subscriptionErrorCount = 0;
  const gen = ++subscriptionGeneration;

  try {
    // Subscribe to queued sessions — claim and start immediately on update
    unsubscribers.push(
      client.onUpdate(
        api.sessions.companionListQueued,
        {},
        (queued) => {
          for (const session of queued) {
            void handleQueuedSession(session);
          }
        },
        (err) => {
          if (gen === subscriptionGeneration) subscriptionErrorCount++;
          console.error('companionListQueued subscription error:', err);
        },
      ),
    );

    // Subscribe to stopped sessions — abort or transition to idle immediately
    unsubscribers.push(
      client.onUpdate(
        api.sessions.companionListStopped,
        {},
        (stopped) => {
          for (const session of stopped) {
            void handleStoppedSession(session);
          }
        },
        (err) => {
          if (gen === subscriptionGeneration) subscriptionErrorCount++;
          console.error('companionListStopped subscription error:', err);
        },
      ),
    );

    // Subscribe to pending messages — deliver immediately on update
    unsubscribers.push(
      client.onUpdate(
        api.sessionMessages.companionListPending,
        {},
        (messages) => {
          for (const msg of messages) {
            void handlePendingMessage(msg);
          }
        },
        (err) => {
          if (gen === subscriptionGeneration) subscriptionErrorCount++;
          console.error('companionListPending subscription error:', err);
        },
      ),
    );
  } catch (err) {
    // Roll back partial registrations so the retry loop can start clean
    stopCompanionSubscriptions();
    throw err;
  }

  console.log('Companion subscriptions started');
}

/**
 * Returns true if subscriptions are established and no subscription has errored.
 * A non-null client with errored subscriptions is functionally equivalent to
 * having no subscriptions — the retry loop in companionPoll uses this to detect
 * and recover from persistent subscription failures (e.g. rotated secrets).
 */
export function isSubscriptionsActive(): boolean {
  return subscriptionsActive && subscriptionErrorCount === 0;
}

/**
 * Unsubscribes all subscription callbacks.
 * Does NOT close the ConvexClient — that's managed by `closeCompanionClients()`.
 */
export function stopCompanionSubscriptions(): void {
  for (const unsub of unsubscribers) unsub();
  unsubscribers.length = 0;
  subscriptionErrorCount = 0;
  subscriptionsActive = false;
  // Do NOT clear inFlight* sets here — handlers still mid-await will clean up
  // their own IDs via finally blocks. Clearing now would allow re-entry on a
  // quick stop/restart before in-flight work settles.
}
