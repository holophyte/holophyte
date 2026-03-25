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

  // Extract available slash commands and skills from the system/init event.
  const availableCommands = useMemo(() => {
    const initEvent = events.find(
      (e) => e.type === 'system' && 'subtype' in e && e.subtype === 'init',
    );
    if (!initEvent) return [];
    const evt = initEvent as Record<string, unknown>;
    const commands = Array.isArray(evt.slash_commands)
      ? (evt.slash_commands as string[])
      : [];
    const skills = Array.isArray(evt.skills) ? (evt.skills as string[]) : [];
    // Dedupe and sort — skills and slash_commands may overlap
    return [...new Set([...commands, ...skills])].sort();
  }, [events]);

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
