import type { ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type {
  PendingApproval,
  SessionStatus,
} from '@/frontend/hooks/useSession';

interface SessionActions {
  approve: (requestId: string) => void;
  deny: (requestId: string, message?: string) => void;
  pendingApprovals: PendingApproval[];
  sessionStatus: SessionStatus | null;
  promptSuggestion: string | null;
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
}: SessionActionsProviderProps) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve,
        deny,
        pendingApprovals,
        sessionStatus,
        promptSuggestion,
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
