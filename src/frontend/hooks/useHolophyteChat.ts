import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PendingApproval,
  ProjectCommand,
  SessionStatus,
} from '@/frontend/hooks/useSession';
import {
  extractPromptSuggestion,
  sdkToUIMessages,
} from '@/frontend/lib/sdkToUIMessages';

export interface UseHolophyteChatProps {
  sessionId: string;
  events: SDKMessage[];
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  projectCommands: ProjectCommand[];
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  sendMessage: (
    sessionId: string,
    text: string,
    reasoningEffort?: string,
  ) => Promise<void>;
  handleStop: () => Promise<void>;
  messageQueued: boolean;
}

export interface UseHolophyteChatReturn {
  messages: UIMessage[];
  status: 'ready' | 'submitted' | 'streaming' | 'error';
  sendMessage: (text: string, reasoningEffort?: string) => Promise<void>;
  stop: () => Promise<void>;
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  promptSuggestion: string | null;
  availableCommands: ProjectCommand[];
  messageQueued: boolean;
  /**
   * True when the last turn was cut short (session is idle but the SDK event
   * stream never produced a terminal `result` event — i.e. the user stopped
   * the session mid-response). The thread UI uses this to render an
   * "— interrupted —" indicator after the last assistant message.
   */
  isInterrupted: boolean;
}

/**
 * Data-layer hook for a Holophyte session thread.
 *
 * Normalizes raw Convex session data (SDK events, pending approvals, session
 * status) into an `ai` package `UIMessage[]` shape, along with derived state
 * and action callbacks. The returned object is consumed by `ActiveSession`,
 * which wires it into `SessionActionsProvider` and `SessionThread`.
 * Any chat UI that accepts `UIMessage[]` can use this hook as its data source.
 */
export function useHolophyteChat(
  props: UseHolophyteChatProps,
): UseHolophyteChatReturn {
  const {
    sessionId,
    events,
    pendingApprovals,
    sessionStatus,
    projectCommands,
    approve,
    deny,
    sendMessage: sendMessageProp,
    handleStop,
    messageQueued,
  } = props;

  const isRunning =
    sessionStatus === 'running' || sessionStatus === 'waiting_input';

  // Map session lifecycle → useChat-compatible status
  const status = useMemo((): UseHolophyteChatReturn['status'] => {
    switch (sessionStatus) {
      case 'queued':
        return 'submitted';
      case 'running':
      case 'waiting_input':
        return 'streaming';
      case 'failed':
        return 'error';
      default:
        return 'ready';
    }
  }, [sessionStatus]);

  // Transform SDK events into UIMessage[]
  const sdkMessages = useMemo(
    () => sdkToUIMessages(events, isRunning, pendingApprovals),
    [events, isRunning, pendingApprovals],
  );

  // A cleanly-ended turn contains a terminal `result` SDK event. Scan backward
  // from the most recent event: if we see a `result` before a `user`, the
  // current turn ended cleanly (even if metadata events like
  // `prompt_suggestion` landed after the result). If we see a `user` first,
  // this turn never produced a `result` — the user hit stop mid-response.
  //
  // Only gate on `idle`: `failed` is an error, not an interruption; `running`
  // and `waiting_input` mean the turn is still in flight.
  //
  // Caveat: `events` and `sessionStatus` come from separate Convex queries, so
  // during a clean completion there's a narrow window where `idle` lands
  // before the final `result` batch does, causing a brief `true` flash. The
  // UI absorbs that flash gracefully — once the event batch arrives, this
  // recomputes and flips back to `false`.
  const isInterrupted = useMemo(() => {
    if (sessionStatus !== 'idle') return false;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (!ev) continue;
      if (ev.type === 'result') return false;
      if (ev.type === 'user') return true;
    }
    return false;
  }, [events, sessionStatus]);

  // Extract the latest prompt suggestion from the event stream
  const promptSuggestion = useMemo(
    () => extractPromptSuggestion(events),
    [events],
  );

  // Merge persisted commands with dynamic skills from the init event.
  // Commands are persisted to Convex; skills come from the event stream.
  const availableCommands = useMemo(() => {
    const initEvent = events.find(
      (e) => e.type === 'system' && 'subtype' in e && e.subtype === 'init',
    );
    const skills: ProjectCommand[] = initEvent
      ? (Array.isArray((initEvent as Record<string, unknown>).skills)
          ? ((initEvent as Record<string, unknown>).skills as string[])
          : []
        ).map((name) => ({ name, description: '' }))
      : [];
    const commandNames = new Set(projectCommands.map((c) => c.name));
    const uniqueSkills = skills.filter((s) => !commandNames.has(s.name));
    return [...projectCommands, ...uniqueSkills].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [events, projectCommands]);

  // Queue of optimistic user messages — shown immediately when the user hits
  // Enter, before the SDK streams back the real user events.
  const [optimisticMsgs, setOptimisticMsgs] = useState<string[]>([]);
  const msgsLenAtOptimistic = useRef(-1);

  // Clear optimistic messages when new SDK events arrive after they were set.
  useEffect(() => {
    if (
      optimisticMsgs.length > 0 &&
      events.length > msgsLenAtOptimistic.current
    ) {
      setOptimisticMsgs([]);
    }
  }, [events.length, optimisticMsgs.length]);

  /** Show a user message optimistically in the thread. */
  const addOptimisticMessage = useCallback(
    (text: string) => {
      setOptimisticMsgs((prev) => [...prev, text]);
      msgsLenAtOptimistic.current = events.length;
    },
    [events.length],
  );

  // Merge SDK messages with optimistic user messages.
  const messages = useMemo((): UIMessage[] => {
    if (optimisticMsgs.length === 0) return sdkMessages;
    return [
      ...sdkMessages,
      ...optimisticMsgs.map((text, i) => ({
        id: `optimistic-${i}`,
        role: 'user' as const,
        parts: [{ type: 'text' as const, text }],
      })),
    ];
  }, [sdkMessages, optimisticMsgs]);

  const sendMessage = useCallback(
    async (text: string, reasoningEffort?: string) => {
      if (!text.trim()) return;
      addOptimisticMessage(text);
      try {
        await sendMessageProp(sessionId, text, reasoningEffort);
      } catch (err) {
        console.error('[useHolophyteChat] sendMessage failed:', err);
        setOptimisticMsgs([]);
      }
    },
    [addOptimisticMessage, sendMessageProp, sessionId],
  );

  return {
    messages,
    status,
    sendMessage,
    stop: handleStop,
    approve,
    deny,
    pendingApprovals,
    sessionStatus,
    promptSuggestion,
    availableCommands,
    messageQueued,
    isInterrupted,
  };
}
