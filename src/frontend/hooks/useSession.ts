import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * - `completed` — session finished successfully
 * - `failed` — session ended with an error
 * - `stopped` — session was stopped by the user
 */
export type SessionStatus =
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'stopped';

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
  const [events, setEvents] = useState<SDKMessage[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>(
    [],
  );
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(
    null,
  );
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const approve = useCallback((requestId: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'approve', requestId }));
    }
    setPendingApprovals((prev) =>
      prev.map((a) =>
        a.requestId === requestId ? { ...a, resolved: { approved: true } } : a,
      ),
    );
  }, []);

  const deny = useCallback((requestId: string, message?: string) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'deny', requestId, message }));
    }
    setPendingApprovals((prev) =>
      prev.map((a) =>
        a.requestId === requestId ? { ...a, resolved: { approved: false } } : a,
      ),
    );
  }, []);

  const sendMessage = useCallback(async (sid: string, text: string) => {
    const res = await fetch(`/api/sessions/${sid}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'message', text }),
    });
    if (!res.ok) {
      throw new Error(await res.text());
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;

    // Reset state on new session
    setEvents([]);
    setPendingApprovals([]);
    setSessionStatus(null);
    setIsConnected(false);

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
        setEvents((prev) => [...prev, msg.event]);
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
      } else if (msg.type === 'error') {
        setSessionStatus('failed');
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
    sessionStatus !== 'completed' &&
    sessionStatus !== 'failed' &&
    sessionStatus !== 'stopped'
      ? 'waiting_input'
      : sessionStatus;

  return {
    events,
    pendingApprovals,
    sessionStatus: derivedStatus,
    isConnected,
    approve,
    deny,
    sendMessage,
  };
}
