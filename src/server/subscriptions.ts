// ── Companion subscriptions ──────────────────────────────────────────────
//
// Uses ConvexClient (WebSocket-based) to subscribe to reactive queries
// instead of polling. Fires immediately when data changes.

import { api } from '@convex/_generated/api';
import { ConvexClient } from 'convex/browser';
import type { PermissionMode } from '@/claude/manager';
import {
  getSession,
  sendMessageToSession,
  startSession,
  stopSession,
} from '@/claude/manager';
import { callConvexInternal, queryConvexInternal } from './convex-client';
import type { PendingMessage, QueuedSession, StoppedSession } from './polling';

/**
 * Derives the companion auth token using Web Crypto — mirrors the Convex-side derivation
 * in `convex/lib/validateSecret.ts`. Both must be kept in sync; they cannot share a
 * module because Convex and Bun run in separate bundler contexts.
 */
async function deriveCompanionToken(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    enc.encode('holophyte-companion-v1'),
  );
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let convexClient: ConvexClient | null = null;
// Prevents two concurrent startCompanionSubscriptions() calls from both passing
// the convexClient === null check across the async deriveCompanionToken gap.
let convexClientStarting = false;
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

  inFlightClaims.add(session._id);
  try {
    const claimed = await queryConvexInternal<{ ok: boolean }>(
      '/api/internal/sessions/claimQueued',
      { id: session._id },
    );
    if (!claimed.ok) return;

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
      await callConvexInternal('/api/internal/sessions/updateStatus', {
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

  inFlightStops.add(session._id);
  try {
    if (getSession(session._id)) {
      stopSession(session._id);
      // Hold the lock until the session is cleaned up so that subscription
      // re-evaluations triggered by heartbeats don't call stopSession() again.
      await waitForSessionGone(session._id);
    } else {
      await callConvexInternal('/api/internal/sessions/updateStatus', {
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

  inFlightMessages.add(msg._id);
  try {
    const delivered = sendMessageToSession(msg.sessionId, msg.text);
    if (delivered) {
      await callConvexInternal('/api/internal/sessionMessages/markConsumed', {
        id: msg._id,
      });
    }
  } catch (err) {
    console.error(`Failed to deliver message ${msg._id}:`, err);
  } finally {
    inFlightMessages.delete(msg._id);
  }
}

export async function startCompanionSubscriptions(opts: {
  convexUrl: string;
  secret: string;
}): Promise<void> {
  if (convexClient || convexClientStarting) return;
  convexClientStarting = true;

  try {
    const token = await deriveCompanionToken(opts.secret);
    convexClient = new ConvexClient(opts.convexUrl);

    // Subscribe to queued sessions — claim and start immediately on update
    unsubscribers.push(
      convexClient.onUpdate(
        api.sessions.companionListQueued,
        { token },
        (queued) => {
          for (const session of queued) {
            void handleQueuedSession(session);
          }
        },
      ),
    );

    // Subscribe to stopped sessions — abort or transition to idle immediately
    unsubscribers.push(
      convexClient.onUpdate(
        api.sessions.companionListStopped,
        { token },
        (stopped) => {
          for (const session of stopped) {
            void handleStoppedSession(session);
          }
        },
      ),
    );

    // Subscribe to pending messages — deliver immediately on update
    unsubscribers.push(
      convexClient.onUpdate(
        api.sessionMessages.companionListPending,
        { token },
        (messages) => {
          for (const msg of messages) {
            void handlePendingMessage(msg);
          }
        },
      ),
    );
  } finally {
    convexClientStarting = false;
  }
}

export function stopCompanionSubscriptions(): void {
  for (const unsub of unsubscribers) unsub();
  unsubscribers.length = 0;
  // Do NOT clear inFlight* sets here — handlers still mid-await will clean up
  // their own IDs via finally blocks. Clearing now would allow re-entry on a
  // quick stop/restart before in-flight work settles.
  convexClient?.close().catch(console.error);
  convexClient = null;
}
