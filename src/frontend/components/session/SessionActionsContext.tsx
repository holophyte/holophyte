import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type {
  PendingApproval,
  ProjectCommand,
  SessionStatus,
} from '@/frontend/hooks/useSession';

interface SessionActions {
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  promptSuggestion: string | null;
  /** Available slash commands and skills from the SDK. */
  availableCommands: ProjectCommand[];
  handleStop: () => Promise<void>;
  messageQueued: boolean;
  sendMessage: (text: string, reasoningEffort?: string) => Promise<void>;
  /** Provider running this session — drives the effort picker option set. */
  provider: 'claude' | 'codex';
  /** Currently selected effort (per-turn). */
  effort: string;
  /** Update effort — persists for subsequent turns within the session. */
  setEffort: (effort: string) => void;
}

export const SessionActionsContext = createContext<SessionActions | null>(null);

interface SessionActionsProviderProps extends SessionActions {
  children: ReactNode;
}

/** Provides session action functions to tool UI renderers within a session. */
export function SessionActionsProvider({
  children,
  approve,
  deny,
  pendingApprovals,
  sessionStatus,
  promptSuggestion,
  availableCommands,
  handleStop,
  messageQueued,
  sendMessage,
  provider,
  effort,
  setEffort,
}: SessionActionsProviderProps) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve,
        deny,
        pendingApprovals,
        sessionStatus,
        promptSuggestion,
        availableCommands,
        handleStop,
        messageQueued,
        sendMessage,
        provider,
        effort,
        setEffort,
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

/**
 * Consumes the {@link SessionActionsContext}.
 * @throws If used outside of a {@link SessionActionsProvider}.
 */
export function useSessionActions(): SessionActions {
  const ctx = useContext(SessionActionsContext);
  if (!ctx) {
    throw new Error(
      'useSessionActions must be used within a SessionActionsProvider',
    );
  }
  return ctx;
}
