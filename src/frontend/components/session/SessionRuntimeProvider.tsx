import type { AppendMessage, ThreadMessageLike } from '@assistant-ui/react';
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ReactNode } from 'react';
import { useMemo } from 'react';
import { useSession } from '@/frontend/hooks/useSession';
import { sdkToThreadMessages } from '@/frontend/lib/sdkToThreadMessages';
import { SessionActionsProvider } from './SessionActionsContext';

interface SessionRuntimeProviderProps {
  sessionId: string;
  children: ReactNode;
}

export default function SessionRuntimeProvider({
  sessionId,
  children,
}: SessionRuntimeProviderProps) {
  const {
    events,
    pendingApprovals,
    sessionStatus,
    approve,
    deny,
    sendMessage,
  } = useSession(sessionId);

  const isRunning = sessionStatus === 'running';

  const messages = useMemo(
    () => sdkToThreadMessages(events, isRunning, pendingApprovals),
    [events, isRunning, pendingApprovals],
  );

  const adapter = useMemo(
    () => ({
      messages,
      isRunning,
      // convertMessage is a pass-through since messages are already ThreadMessageLike
      convertMessage: (m: ThreadMessageLike) => m,
      onNew: async (message: AppendMessage) => {
        const text = message.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n');
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
