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
  handleStop: () => Promise<void>;
  messageQueued: boolean;
  sendMessageDirect: (text: string) => Promise<void>;
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
  handleStop,
  messageQueued,
  sendMessageDirect,
  children,
}: SessionRuntimeProviderProps) {
  const isRunning = sessionStatus === 'running';

  const sdkMessages = useMemo(() => {
    return sdkToThreadMessages(events, isRunning, pendingApprovals);
  }, [events, isRunning, pendingApprovals]);

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

  /** Show a user message optimistically in the thread (used by both onNew and direct send). */
  const addOptimisticMessage = useCallback(
    (text: string) => {
      setOptimisticMsgs((prev) => [...prev, text]);
      msgsLenAtOptimistic.current = events.length;
    },
    [events.length],
  );

  // Merge SDK messages with optimistic user messages.
  const messages = useMemo(() => {
    if (optimisticMsgs.length === 0) return sdkMessages;
    return [
      ...sdkMessages,
      ...optimisticMsgs.map((text, i) => ({
        id: `optimistic-${i}`,
        role: 'user' as const,
        content: [{ type: 'text' as const, text }],
      })),
    ];
  }, [sdkMessages, optimisticMsgs]);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const text = message.content
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n');
      if (!text.trim()) return;

      // Show the message immediately so the user sees feedback
      addOptimisticMessage(text);

      try {
        await sendMessage(sessionId, text);
      } catch (err) {
        console.error('[SessionRuntime] onNew failed:', err);
        // Clear optimistic messages on failure — they won't be processed
        setOptimisticMsgs([]);
      }
    },
    [addOptimisticMessage, sendMessage, sessionId],
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
        handleStop={handleStop}
        messageQueued={messageQueued}
        sendMessage={sendMessageDirect}
        addOptimisticMessage={addOptimisticMessage}
      >
        {children}
      </SessionActionsProvider>
    </AssistantRuntimeProvider>
  );
}
