import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WsServerMessage } from '@/claude/manager';

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
 * - `running` — session is actively processing
 * - `waiting_input` — derived state: one or more tool-use approvals are pending
 * - `idle` — session turn completed; process has exited. Can be resumed.
 * - `failed` — session ended with an error
 */
export type SessionStatus = 'running' | 'waiting_input' | 'idle' | 'failed';

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
   * Current lifecycle status. `null` while the WebSocket is connecting and no
   * status event has been received yet.
   */
  sessionStatus: SessionStatus | null;
  /** Whether the WebSocket connection is currently open. */
  isConnected: boolean;
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
   * Approve a pending tool-use request. Sends `{ type: 'approve', requestId }`
   * over the WebSocket and marks the approval as resolved in local state.
   *
   * @param requestId - The `requestId` from the {@link PendingApproval}.
   */
  approve: (requestId: string) => void;
  /**
   * Deny a pending tool-use request. Sends `{ type: 'deny', requestId, message }`
   * over the WebSocket and marks the approval as resolved in local state.
   *
   * @param requestId - The `requestId` from the {@link PendingApproval}.
   * @param message - Optional reason surfaced to Claude as feedback.
   */
  deny: (requestId: string, message?: string) => void;
  /**
   * Send a follow-up message to Claude mid-session. Posts to
   * `POST /api/sessions/:id/respond` with `{ type: 'message', text }`.
   *
   * @param sessionId - The Convex session ID (same as used by the hook).
   * @param text - The message text to inject into the SDK conversation.
   */
  sendMessage: (sessionId: string, text: string) => Promise<void>;
}

function tryParseWsMessage(data: string): WsServerMessage | null {
  try {
    return JSON.parse(data) as WsServerMessage;
  } catch {
    return null;
  }
}

/**
 * Manages the WebSocket connection and state for a single Claude Code session.
 *
 * Connects to `/ws/session/:sessionId` when `sessionId` is non-null and
 * processes incoming {@link WsServerMessage} frames:
 *
 * - `event` — appends SDK events to the `events` array
 * - `permission` — adds a {@link PendingApproval}; `waiting_input` is then
 *   derived automatically by `derivedStatus` from unresolved approvals
 * - `status` — updates `sessionStatus`; `waiting_input` is derived locally
 *   from unresolved pending approvals and overrides a backend `running` status
 * - `error` — sets status to `failed`
 *
 * Pending approvals are replayed by the server on connect, so a reconnecting
 * client won't miss them. The hook deduplicates replayed entries.
 *
 * Full conversation history is loaded from Convex on mount (persisted events
 * from prior flushes), then merged with live WebSocket events so late-connecting
 * clients see the complete history.
 *
 * @param sessionId - The Convex session ID to connect to, or `null` to remain
 *   disconnected. Changing this value closes the old connection and opens a new one.
 * @returns State and action callbacks for the session. See {@link UseSessionReturn}.
 *
 * @example
 * ```tsx
 * const { events, pendingApprovals, approve, deny, sendMessage } = useSession(sessionId);
 * ```
 */
export function useSession(sessionId: string | null): UseSessionReturn {
  // Events received over WebSocket (un-flushed buffer replay + live events).
  const [wsEvents, setWsEvents] = useState<SDKMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
    [],
  );
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null,
  );
  const [isConnected, setIsConnected] = useState(false);
  const [messageQueued, setMessageQueued] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  // Load the session record so we can access sdkSessionId for resume.
  const sessionRecord = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<'sessions'> } : 'skip',
  );

  // Load persisted event batches from Convex (already-flushed history).
  // Returns undefined while loading; skip when sessionId is null.
  const persistedBatches = useQuery(
    api.sessionEvents.getBySession,
    sessionId ? { sessionId: sessionId as Id<'sessions'> } : 'skip',
  );

  // Flatten persisted batches (ordered by batchIndex) into a single event list.
  const persistedEvents = useMemo<SDKMessage[]>(() => {
    if (!persistedBatches) return [];
    return persistedBatches.flatMap((batch) =>
      batch.events.map((e) => JSON.parse(e.data) as SDKMessage),
    );
  }, [persistedBatches]);

  // Merge: persisted history first, then WS events (un-flushed tail + live).
  // Deduplicate by uuid — Convex useQuery is reactive, so events that were
  // received live via WS may later appear in persistedEvents after a flush.
  const events = useMemo<SDKMessage[]>(() => {
    const seen = new Set<string>();
    const result: SDKMessage[] = [];
    for (const event of persistedEvents) {
      const uuid = (event as { uuid?: string }).uuid;
      if (uuid) seen.add(uuid);
      result.push(event);
    }
    for (const event of wsEvents) {
      const uuid = (event as { uuid?: string }).uuid;
      if (uuid && seen.has(uuid)) continue;
      if (uuid) seen.add(uuid);
      result.push(event);
    }
    return result;
  }, [persistedEvents, wsEvents]);

  const approve = useCallback((requestId: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'approve', requestId }));
    setPendingApprovals((prev) =>
      prev.map((a) =>
        a.requestId === requestId ? { ...a, resolved: { approved: true } } : a,
      ),
    );
  }, []);

  const deny = useCallback((requestId: string, message?: string) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'deny', requestId, message }));
    setPendingApprovals((prev) =>
      prev.map((a) =>
        a.requestId === requestId ? { ...a, resolved: { approved: false } } : a,
      ),
    );
  }, []);

  const sendMessage = useCallback(
    async (sid: string, text: string) => {
      const res = await fetch(`/api/sessions/${sid}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'message', text }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      // If the session was running, the message is queued — show an indicator
      if (sessionStatus === 'running') {
        setMessageQueued(true);
      }
    },
    [sessionStatus],
  );

  useEffect(() => {
    if (!sessionId) return;

    // Reset WS-side state on new session (persisted events reset via useQuery)
    setWsEvents([]);
    setPendingApprovals([]);
    setSessionStatus(null);
    setIsConnected(false);
    setMessageQueued(false);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(
      `${protocol}//${window.location.host}/ws/session/${sessionId}`,
    );

    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
    };

    ws.onmessage = (rawEvent) => {
      const msg = tryParseWsMessage(rawEvent.data as string);
      if (!msg) return;

      if (msg.type === 'event') {
        setWsEvents((prev) => [...prev, msg.event]);
      } else if (msg.type === 'permission') {
        setPendingApprovals((prev) => {
          // Avoid duplicates on reconnect replay
          if (prev.some((a) => a.requestId === msg.requestId)) return prev;
          return [
            ...prev,
            { requestId: msg.requestId, tool: msg.tool, input: msg.input },
          ];
        });
        // No direct setSessionStatus here — derivedStatus computes waiting_input
        // from unresolved pendingApprovals automatically.
      } else if (msg.type === 'status') {
        setSessionStatus(msg.status as SessionStatus);
        // Clear queued indicator once the session moves past running
        if (msg.status !== 'running') {
          setMessageQueued(false);
        }
      } else if (msg.type === 'error') {
        // If the server says "Session not found", the session process died
        // before it could update Convex (e.g. server restart). In that case
        // the session is stale-running rather than truly failed — treat it as
        // idle so the user can resume it. For all other errors, mark failed.
        if (msg.message === 'Session not found') {
          setSessionStatus('idle');
        } else {
          setSessionStatus('failed');
        }
        setMessageQueued(false);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sessionId]);

  // Derive sessionStatus: if there are unresolved approvals, show waiting_input
  // (handles the case where a 'running' status arrives after a permission prompt)
  const derivedStatus: SessionStatus | null =
    pendingApprovals.some((a) => !a.resolved) &&
    sessionStatus !== 'idle' &&
    sessionStatus !== 'failed'
      ? 'waiting_input'
      : sessionStatus;

  return {
    events,
    pendingApprovals,
    sessionStatus: derivedStatus,
    isConnected,
    messageQueued,
    sdkSessionId: sessionRecord?.sdkSessionId,
    approve,
    deny,
    sendMessage,
  };
}
