import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * A tool-use permission request that the user must approve or deny before
 * Claude can proceed.
 */
export interface PendingApproval {
  /** Unique identifier for this approval request (matches the SDK tool use ID). */
  requestId: string;
  /** Name of the Claude tool that requires approval (e.g. `"Bash"`, `"Edit"`). */
  tool: string;
  /** Tool input parameters — content varies by tool. */
  input: Record<string, unknown>;
  /**
   * Present once the user has responded. `approved: true` means the tool was
   * allowed; `approved: false` means it was denied.
   */
  resolved?: { approved: boolean };
}

/**
 * Lifecycle status of a Claude Code session as seen by the frontend.
 *
 * - `queued` — session created, waiting for companion to pick it up
 * - `running` — session is actively processing
 * - `waiting_input` — derived state: one or more tool-use approvals are pending
 * - `idle` — session turn completed; process has exited. Can be resumed.
 * - `failed` — session ended with an error
 */
export type SessionStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'idle'
  | 'failed';

/**
 * Return value of {@link useSession}.
 */
export interface UseSessionReturn {
  /** Accumulated SDK events for the active session in arrival order. */
  events: SDKMessage[];
  /**
   * Tool-use permission requests. Includes both unresolved (pending) and
   * resolved entries so the UI can show historical approval context.
   */
  pendingApprovals: PendingApproval[];
  /**
   * Current lifecycle status. `null` while the session record is loading and no
   * status has been determined yet.
   */
  sessionStatus: SessionStatus | null;
  /** Whether the companion server is reachable (heartbeat recent or session is queued). */
  companionOnline: boolean;
  /**
   * `true` when a message has been sent while the session was in `running`
   * state and is queued for delivery once the current turn ends.
   */
  messageQueued: boolean;
  /**
   * The SDK session ID from Convex, used to resume idle sessions.
   * Available once the session has been initialized by the SDK.
   */
  sdkSessionId: string | undefined;
  /**
   * Approve a pending tool-use request. Resolves the approval via Convex mutation.
   *
   * @param requestId - The `requestId` from the {@link PendingApproval}.
   */
  approve: (requestId: string) => void;
  /**
   * Deny a pending tool-use request. Resolves the approval via Convex mutation.
   *
   * @param requestId - The `requestId` from the {@link PendingApproval}.
   * @param message - Optional reason surfaced to Claude as feedback.
   */
  deny: (requestId: string, message?: string) => void;
  /**
   * Send a follow-up message to Claude. Writes to the `sessionMessages` table
   * in Convex for the companion to pick up and deliver to the SDK process.
   *
   * @param sessionId - The Convex session ID (same as used by the hook).
   * @param text - The message text to inject into the SDK conversation.
   */
  sendMessage: (sessionId: string, text: string) => Promise<void>;
}

const HEARTBEAT_STALE_MS = 10_000;

/**
 * Manages state for a single Claude Code session using Convex subscriptions.
 *
 * Subscribes to Convex for events, approvals, and session status. All state
 * is derived from Convex real-time data — no WebSocket connection is required.
 *
 * @param sessionId - The Convex session ID to subscribe to, or `null` to remain
 *   disconnected. Changing this value switches subscriptions to the new session.
 * @returns State and action callbacks for the session. See {@link UseSessionReturn}.
 *
 * @example
 * ```tsx
 * const { events, pendingApprovals, approve, deny, sendMessage } = useSession(sessionId);
 * ```
 */
export function useSession(sessionId: string | null): UseSessionReturn {
  const [messageQueued, setMessageQueued] = useState(false);

  // Convex mutations
  const sendSessionMessage = useMutation(api.sessionMessages.send);
  const resolveApproval = useMutation(api.pendingApprovals.resolve);

  // Load session record for status and sdkSessionId
  const sessionRecord = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<'sessions'> } : 'skip',
  );

  // Load persisted event batches from Convex
  const persistedBatches = useQuery(
    api.sessionEvents.getBySession,
    sessionId ? { sessionId: sessionId as Id<'sessions'> } : 'skip',
  );

  // Load pending approvals from Convex
  const convexApprovals = useQuery(
    api.pendingApprovals.getBySession,
    sessionId ? { sessionId: sessionId as Id<'sessions'> } : 'skip',
  );

  // Flatten persisted batches into a single event list
  const events = useMemo<SDKMessage[]>(() => {
    if (!persistedBatches) return [];
    return persistedBatches.flatMap((batch) =>
      batch.events.map((e) => JSON.parse(e.data) as SDKMessage),
    );
  }, [persistedBatches]);

  // Map Convex approvals to PendingApproval shape
  const pendingApprovals = useMemo<PendingApproval[]>(() => {
    if (!convexApprovals) return [];
    return convexApprovals.map((a) => ({
      requestId: a.requestId,
      tool: a.tool,
      input: JSON.parse(a.input) as Record<string, unknown>,
      resolved: a.resolved ? { approved: !!a.approved } : undefined,
    }));
  }, [convexApprovals]);

  // Map Convex status to frontend SessionStatus
  const convexStatus = sessionRecord?.status;
  const mappedStatus: SessionStatus | null =
    convexStatus === 'queued'
      ? 'queued'
      : convexStatus === 'stopped'
        ? 'idle'
        : ((convexStatus as SessionStatus | undefined) ?? null);

  // Derive waiting_input from unresolved approvals
  const hasUnresolvedApprovals = pendingApprovals.some((a) => !a.resolved);
  const sessionStatus: SessionStatus | null =
    hasUnresolvedApprovals && mappedStatus === 'running'
      ? 'waiting_input'
      : mappedStatus;

  // Reset messageQueued when session stops running (computed during render)
  const prevStatusRef = useRef(sessionStatus);
  if (
    prevStatusRef.current === 'running' &&
    sessionStatus !== 'running' &&
    sessionStatus !== 'waiting_input'
  ) {
    setMessageQueued(false);
  }
  prevStatusRef.current = sessionStatus;

  // Refresh "now" every 5s to keep companionOnline fresh
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const companionOnline =
    sessionStatus === 'queued' ||
    (sessionRecord?.lastHeartbeat != null &&
      now - sessionRecord.lastHeartbeat < HEARTBEAT_STALE_MS);

  const approve = useCallback(
    (requestId: string) => {
      if (!sessionId) return;
      void resolveApproval({
        sessionId: sessionId as Id<'sessions'>,
        requestId,
        approved: true,
      });
    },
    [sessionId, resolveApproval],
  );

  const deny = useCallback(
    (requestId: string, message?: string) => {
      if (!sessionId) return;
      void resolveApproval({
        sessionId: sessionId as Id<'sessions'>,
        requestId,
        approved: false,
        denyMessage: message,
      });
    },
    [sessionId, resolveApproval],
  );

  const sendMessage = useCallback(
    async (sid: string, text: string) => {
      await sendSessionMessage({
        sessionId: sid as Id<'sessions'>,
        text,
      });
      // If the session was running, the message is queued — show an indicator
      if (sessionStatus === 'running') {
        setMessageQueued(true);
      }
    },
    [sessionStatus, sendSessionMessage],
  );

  return {
    events,
    pendingApprovals,
    sessionStatus,
    companionOnline,
    messageQueued,
    sdkSessionId: sessionRecord?.sdkSessionId,
    approve,
    deny,
    sendMessage,
  };
}
