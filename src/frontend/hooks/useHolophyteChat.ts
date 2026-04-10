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
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  handleStop: () => Promise<void>;
  messageQueued: boolean;
}

export interface UseHolophyteChatReturn {
  messages: UIMessage[];
  status: 'ready' | 'submitted' | 'streaming' | 'error';
  id: string;
  sendMessage: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  addOptimisticMessage: (text: string) => void;
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  promptSuggestion: string | null;
  availableCommands: ProjectCommand[];
  messageQueued: boolean;
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
    async (text: string) => {
      if (!text.trim()) return;
      addOptimisticMessage(text);
      try {
        await sendMessageProp(sessionId, text);
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
    id: sessionId,
    sendMessage,
    stop: handleStop,
    addOptimisticMessage,
    approve,
    deny,
    pendingApprovals,
    sessionStatus,
    promptSuggestion,
    availableCommands,
    messageQueued,
  };
}
