import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
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
   * Current lifecycle status. `null` while the WebSocket is connecting and no
   * status event has been received yet.
   */
  sessionStatus: SessionStatus | null;
  /** Whether the WebSocket connection is currently open. */
  isConnected: boolean;
  /** Whether the companion server is reachable (WebSocket connected or session is queued). */
  companionOnline: boolean;
  /**
   * `true` when a message has been sent while the session was in `running`
   * state and is queued for delivery once the current turn ends.
   */
  messageQueued: boolean;
  /**
   * Non-null when the server reports that session data could not be persisted
   * to the database. Displayed as a warning banner in the UI.
   */
  persistenceWarning: string | null;
  /**
   * The SDK session ID from Convex, used to resume idle sessions.
   * Available once the session has been initialized by the SDK.
   */
  sdkSessionId: string | undefined;
  /**
   * Force the WebSocket to reconnect. Used after resuming an idle session so
   * the WS picks up the newly created server-side session.
   */
  reconnectWs: () => void;
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
   * Send a follow-up message to Claude. Writes to the `sessionMessages` table
   * in Convex for the companion to pick up and deliver to the SDK process.
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
 * The WebSocket connection requires the companion server to be running locally.
 * When the companion is offline, the hook degrades gracefully: sessions can
 * still be created/resumed via Convex mutations, but real-time streaming and
 * approvals are unavailable until the companion connects.
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
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(
    null,
  );

  // Bumping this forces the WS effect to reconnect (used after resume).
  const [wsConnectKey, setWsConnectKey] = useState(0);
  const reconnectWs = useCallback(() => setWsConnectKey((k) => k + 1), []);

  const wsRef = useRef<WebSocket | null>(null);

  // Convex mutation for sending follow-up messages
  const sendSessionMessage = useMutation(api.sessionMessages.send);

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

  // biome-ignore lint/correctness/useExhaustiveDependencies: wsConnectKey is an intentional re-trigger dependency for reconnectWs()
  useEffect(() => {
    if (!sessionId) return;

    // Reset WS-side state on new session (persisted events reset via useQuery)
    setWsEvents([]);
    setPendingApprovals([]);
    setSessionStatus(null);
    setIsConnected(false);
    setMessageQueued(false);
    setPersistenceWarning(null);

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const RECONNECT_DELAY_MS = 2000;
    const MAX_RECONNECT_ATTEMPTS = 15;
    let reconnectAttempts = 0;

    function connect() {
      if (disposed) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws: WebSocket;
      try {
        ws = new WebSocket(
          `${protocol}//${window.location.host}/ws/session/${sessionId}`,
        );
      } catch {
        // WebSocket constructor can throw if the URL is invalid or blocked
        return;
      }

      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        reconnectAttempts = 0; // Reset on successful connection
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
        } else if (msg.type === 'warning') {
          setPersistenceWarning(msg.message);
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

      ws.onerror = () => {
        // Companion offline — WebSocket failed to connect. Status will be
        // derived from the Convex record instead.
        setIsConnected(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        if (wsRef.current === ws) wsRef.current = null;

        // Auto-reconnect unless we've been disposed or hit the limit
        if (!disposed && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };
    }

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [sessionId, wsConnectKey]);

  // Fall back to the Convex record status when the WebSocket hasn't reported
  // a status yet (e.g. the WS connected before the server created the session,
  // got "Session not found", and closed — but Convex already shows "running").
  // Also map 'queued' and 'stopped' Convex statuses to frontend equivalents.
  const convexStatus = sessionRecord?.status;
  const mappedConvexStatus: SessionStatus | null =
    convexStatus === 'queued'
      ? 'queued'
      : convexStatus === 'stopped'
        ? 'idle' // 'stopped' is transient — treat as idle for the UI
        : ((convexStatus as SessionStatus | undefined) ?? null);

  const effectiveStatus: SessionStatus | null =
    sessionStatus ?? mappedConvexStatus;

  // Derive sessionStatus: if there are unresolved approvals, show waiting_input
  // (handles the case where a 'running' status arrives after a permission prompt)
  const derivedStatus: SessionStatus | null =
    pendingApprovals.some((a) => !a.resolved) &&
    effectiveStatus !== 'idle' &&
    effectiveStatus !== 'failed' &&
    effectiveStatus !== 'queued'
      ? 'waiting_input'
      : effectiveStatus;

  // Companion is online if WS is connected, or if the session hasn't started
  // yet (queued) which doesn't need the WS.
  const companionOnline = isConnected || derivedStatus === 'queued';

  return {
    events,
    pendingApprovals,
    sessionStatus: derivedStatus,
    isConnected,
    companionOnline,
    messageQueued,
    persistenceWarning,
    sdkSessionId: sessionRecord?.sdkSessionId,
    reconnectWs,
    approve,
    deny,
    sendMessage,
  };
}
