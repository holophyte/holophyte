import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  PendingApproval,
  ProjectCommand,
  SessionStatus,
} from '@/frontend/hooks/useSession';
import {
  extractPromptSuggestion,
  sdkToThreadMessages,
} from '@/frontend/lib/sdkToThreadMessages';

import { SessionActionsProvider } from './SessionActionsContext';

interface SessionRuntimeProviderProps {
  sessionId: string;
  events: SDKMessage[];
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  projectCommands: ProjectCommand[];
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  sendMessage: (sessionId: string, text: string) => Promise<void>;
  children: ReactNode;
}

export default function SessionRuntimeProvider({
  sessionId,
  events,
  pendingApprovals,
  sessionStatus,
  projectCommands,
  approve,
  deny,
  sendMessage,
  children,
}: SessionRuntimeProviderProps) {
  const isRunning = sessionStatus === 'running';

  // Optimistic user message — shown immediately when the user hits Enter,
  // before the SDK streams back the real user event.
  const [optimisticUserMsg, setOptimisticUserMsg] = useState<string | null>(
    null,
  );
  // Track the events length when the optimistic message was set so we only
  // clear it once NEW events arrive (not on the same render cycle).
  const eventsLenAtOptimistic = useRef(-1);

  // Clear optimistic message when new SDK events arrive after it was set.
  useEffect(() => {
    if (optimisticUserMsg && events.length > eventsLenAtOptimistic.current) {
      setOptimisticUserMsg(null);
    }
  }, [events.length, optimisticUserMsg]);

  const sdkMessages = useMemo(
    () => sdkToThreadMessages(events, isRunning, pendingApprovals),
    [events, isRunning, pendingApprovals],
  );

  const promptSuggestion = useMemo(
    () => extractPromptSuggestion(events),
    [events],
  );

  // Commands and skills from the SDK's supportedCommands(), persisted to Convex
  const availableCommands = projectCommands;

  // Merge SDK messages with the optimistic user message (if any).
  const messages = useMemo(() => {
    if (!optimisticUserMsg) return sdkMessages;
    return [
      ...sdkMessages,
      {
        id: `optimistic-${Date.now()}`,
        role: 'user' as const,
        content: [{ type: 'text' as const, text: optimisticUserMsg }],
      },
    ];
  }, [sdkMessages, optimisticUserMsg]);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (isRunning) return; // Composer is disabled during running; extra safety
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (!text.trim()) return;

      // Show the message immediately so the user sees feedback
      setOptimisticUserMsg(text);
      eventsLenAtOptimistic.current = events.length;

      try {
        await sendMessage(sessionId, text);
      } catch (err) {
        console.error('[SessionRuntime] onNew failed:', err);
        // Clear optimistic message on failure — it won't be processed
        setOptimisticUserMsg(null);
      }
    },
    [isRunning, sendMessage, sessionId, events.length],
  );

  const adapter = useMemo(
    () => ({
      messages,
      isRunning,
      convertMessage: (m: ThreadMessageLike) => m,
      onNew,
    }),
    [messages, isRunning, onNew],
  );

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SessionActionsProvider
        approve={approve}
        deny={deny}
        pendingApprovals={pendingApprovals}
        sessionStatus={sessionStatus}
        promptSuggestion={promptSuggestion}
        availableCommands={availableCommands}
      >
        {children}
      </SessionActionsProvider>
    </AssistantRuntimeProvider>
  );
}
