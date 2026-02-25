import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import type {
  PendingApproval,
  SessionStatus,
} from '@/frontend/hooks/useSession';
import { sdkToThreadMessages } from '@/frontend/lib/sdkToThreadMessages';
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

  const messages = useMemo(
    () => sdkToThreadMessages(events, isRunning, pendingApprovals),
    [events, isRunning, pendingApprovals],
  );

  const adapter = useMemo(
    () => ({
      messages,
      isRunning,
      convertMessage: (m: ThreadMessageLike) => m,
      onNew: async (message: AppendMessage) => {
        if (isRunning) return; // Can't send while session is active
        const text = message.content
          .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
        if (!text.trim()) return;
        await sendMessage(sessionId, text);
      },
    }),
    [messages, isRunning, sendMessage, sessionId],
  );

  const runtime = useExternalStoreRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SessionActionsProvider
        approve={approve}
        deny={deny}
        pendingApprovals={pendingApprovals}
        sessionStatus={sessionStatus}
      >
        {children}
      </SessionActionsProvider>
    </AssistantRuntimeProvider>
  );
}
