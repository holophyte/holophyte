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

let convexClient: ConvexClient | null = null;
const unsubscribers: Array<() => void> = [];

// Track in-flight operations to avoid double-processing the same item
// when the subscription fires multiple times before an item is claimed/stopped.
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

async function handleStoppedSession(session: StoppedSession): Promise<void> {
  if (inFlightStops.has(session._id)) return;

  inFlightStops.add(session._id);
  try {
    if (getSession(session._id)) {
      stopSession(session._id);
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

export function startCompanionSubscriptions(opts: {
  convexUrl: string;
  secret: string;
}): void {
  if (convexClient) return;

  convexClient = new ConvexClient(opts.convexUrl);

  // Subscribe to queued sessions — claim and start immediately on update
  unsubscribers.push(
    convexClient.onUpdate(
      api.sessions.companionListQueued,
      { secret: opts.secret },
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
      { secret: opts.secret },
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
      { secret: opts.secret },
      (messages) => {
        for (const msg of messages) {
          void handlePendingMessage(msg);
        }
      },
    ),
  );
}

export function stopCompanionSubscriptions(): void {
  for (const unsub of unsubscribers) unsub();
  unsubscribers.length = 0;
  void convexClient?.close();
  convexClient = null;
}
