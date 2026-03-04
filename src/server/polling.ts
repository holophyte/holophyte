// ── Companion polling ────────────────────────────────────────────────

import { hostname } from 'node:os';
import type { PermissionMode } from '@/claude/manager';
import {
  getActiveSessions,
  getSession,
  sendMessageToSession,
  startSession,
  stopSession,
} from '@/claude/manager';
import { callConvexInternal, queryConvexInternal } from './convex-client';

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

export async function companionPoll() {
  if (polling) return; // Skip if previous poll is still running
  polling = true;

  try {
    // 1. Pick up queued sessions
    const queued = await queryConvexInternal<QueuedSession[]>(
      '/api/internal/sessions/listQueued',
      {},
    );
    for (const session of queued) {
      if (!session.queuedPrompt) continue;
      // Skip if this session is already running locally
      if (getSession(session._id)) continue;

      try {
        const claimed = await queryConvexInternal<{ ok: boolean }>(
          '/api/internal/sessions/claimQueued',
          { id: session._id },
        );
        if (!claimed.ok) continue;

        await startSession({
          sessionId: session._id,
          repoPath: session.repoPath,
          prompt: session.queuedPrompt,
          model: session.model,
          permissionMode: session.permissionMode as PermissionMode | undefined,
          resumeSdkSessionId: session.sdkSessionId,
        });
      } catch (err) {
        console.error(`Failed to pick up queued session ${session._id}:`, err);
        // Mark as failed so it doesn't retry forever
        try {
          await callConvexInternal('/api/internal/sessions/updateStatus', {
            id: session._id,
            status: 'failed',
          });
        } catch {
          // Best-effort
        }
      }
    }

    // 2. Check for stopped sessions (user requested stop via Convex)
    const stopped = await queryConvexInternal<StoppedSession[]>(
      '/api/internal/sessions/listStopped',
      {},
    );
    for (const session of stopped) {
      if (getSession(session._id)) {
        stopSession(session._id);
      } else {
        // Session not running locally — transition to idle directly
        try {
          await callConvexInternal('/api/internal/sessions/updateStatus', {
            id: session._id,
            status: 'idle',
          });
        } catch {
          // Best-effort
        }
      }
    }

    // 3. Deliver pending messages to running sessions
    const messages = await queryConvexInternal<PendingMessage[]>(
      '/api/internal/sessionMessages/listPending',
      {},
    );
    for (const msg of messages) {
      const delivered = sendMessageToSession(msg.sessionId, msg.text);
      // Mark consumed only on successful delivery — if the session isn't
      // running locally, leave the message unconsumed for retry.
      if (delivered) {
        try {
          await callConvexInternal(
            '/api/internal/sessionMessages/markConsumed',
            { id: msg._id },
          );
        } catch (err) {
          console.error(`Failed to mark message ${msg._id} as consumed:`, err);
        }
      }
    }
    // 4. Send heartbeat for all active sessions
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

    // 5. Send companion-level heartbeat (every cycle, even with zero sessions)
    try {
      await callConvexInternal('/api/internal/companion/heartbeat', {
        activeSessionCount: activeIds.length,
        machineId: MACHINE_ID,
      });
    } catch {
      // Best-effort — don't log every failure
    }
  } catch (err) {
    // Don't log every poll failure (noisy when Convex is unavailable)
    if (String(err).includes('not set')) return;
    console.error('Companion poll error:', err);
  } finally {
    polling = false;
  }
}

export function startCompanionPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(companionPoll, POLL_INTERVAL_MS);
  // Run immediately on start
  void companionPoll();
}

export function stopCompanionPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
