import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/frontend/hooks/useSession';
import { isEditableElement } from '@/frontend/lib/dom';
import { useAppStore } from '@/frontend/stores/app';
import MessageStream from './MessageStream';
import PermissionPrompt from './PermissionPrompt';
import SessionDropdown from './SessionDropdown';
import UserInput from './UserInput';
import Button from './ui/Button';

/** Props for {@link SessionPanel}. */
interface SessionPanelProps {
  /** The task this panel is scoped to — used to create the first session. */
  taskId: Id<'tasks'>;
}

/**
 * Full-height session stream pane with pinned permission prompts + input.
 * Rendered inside the dedicated task page view.
 */
export default function SessionPanel({ taskId }: SessionPanelProps) {
  const sessionId = useAppStore((s) => s.activeSessionId);
  const closeSession = useAppStore((s) => s.closeSession);
  const openSession = useAppStore((s) => s.openSession);
  const updateSessionStatus = useMutation(api.sessions.updateStatus);
  const createSession = useMutation(api.sessions.create);

  // Load the session record so we can access sdkSessionId, etc.
  const session = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<'sessions'> } : 'skip',
  );

  // Load the task (with repo) using the prop directly — needed for repoPath
  // whether or not there's an active session.
  const task = useQuery(api.tasks.get, { id: taskId });

  // Close the panel when the underlying session has been deleted (e.g. repo cascade delete)
  useEffect(() => {
    if (session === null) {
      closeSession();
    }
  }, [session, closeSession]);

  const {
    events,
    pendingApprovals,
    sessionStatus,
    messageQueued,
    sdkSessionId,
    approve,
    deny,
    sendMessage,
  } = useSession(sessionId);

  const [stopping, setStopping] = useState(false);

  const handleStop = async () => {
    if (!sessionId) return;
    setStopping(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/stop`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        console.error('Failed to stop session:', data.error);
      }
      // Fallback: ensure status is updated even if the exit event has no subscriber
      await updateSessionStatus({
        id: sessionId as Id<'sessions'>,
        status: 'idle',
      });
    } catch (err) {
      console.error('Failed to stop session:', err);
    } finally {
      setStopping(false);
    }
  };

  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (sessionStatus !== 'running') return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [sessionStatus]);

  const thinkingElapsedSeconds =
    sessionStatus === 'running' && session
      ? Math.max(
          0,
          Math.floor(
            (now - (session.lastActivityAt ?? session.startedAt)) / 1000,
          ),
        )
      : undefined;

  const unresolvedApprovals = pendingApprovals.filter((a) => !a.resolved);

  useEffect(() => {
    if (unresolvedApprovals.length === 0) return;

    const handleApprovalHotkeys = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const activeElement = document.activeElement;
      const isEditable = isEditableElement(activeElement);

      const promptEl =
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>(
              '[data-permission-prompt][data-resolved="false"]',
            )
          : null;
      const focusedPromptId = promptEl?.dataset.requestId;
      const fallbackPromptId =
        unresolvedApprovals.length === 1 && !isEditable
          ? unresolvedApprovals[0]?.requestId
          : undefined;
      const targetPromptId = focusedPromptId ?? fallbackPromptId;
      if (!targetPromptId) return;

      if (
        !isEditable &&
        (event.key.toLowerCase() === 'y' || event.key === 'Enter')
      ) {
        event.preventDefault();
        approve(targetPromptId);
        return;
      }

      if (
        !isEditable &&
        (event.key.toLowerCase() === 'n' || event.key === 'Escape')
      ) {
        event.preventDefault();
        deny(targetPromptId);
      }
    };

    document.addEventListener('keydown', handleApprovalHotkeys);
    return () => document.removeEventListener('keydown', handleApprovalHotkeys);
  }, [approve, deny, unresolvedApprovals]);

  // 'idle' is not finished from the user's perspective — they can still resume
  const isFinished = sessionStatus === 'failed';
  const isLoading =
    !isFinished &&
    sessionStatus !== 'idle' &&
    events.length === 0 &&
    sessionId !== null;

  /**
   * Handle sending a message. Covers three cases:
   * 1. No session — create a new one and start it with the given prompt.
   * 2. Idle session — resume the existing session in-place.
   * 3. Running session — forward the message via WebSocket.
   */
  const handleSend = async (_sid: string, text: string) => {
    // Case 1: No active session — create one and start it
    if (!sessionId && task?.repo?.path) {
      let newSessionId: Id<'sessions'> | undefined;
      try {
        newSessionId = await createSession({ taskId });
        const res = await fetch('/api/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: newSessionId,
            repoPath: task.repo.path,
            prompt: text,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to start session');
        }
        openSession(newSessionId);
      } catch (err) {
        if (newSessionId) {
          await updateSessionStatus({ id: newSessionId, status: 'failed' });
        }
        throw err;
      }
      return;
    }

    // Case 2: Idle session — resume in-place
    if (
      sessionStatus === 'idle' &&
      session?.taskId &&
      sdkSessionId &&
      task?.repo?.path
    ) {
      try {
        await updateSessionStatus({ id: session._id, status: 'running' });
        const res = await fetch('/api/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: session._id,
            repoPath: task.repo.path,
            prompt: text,
            resumeSdkSessionId: sdkSessionId,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to resume session');
        }
      } catch (err) {
        // Revert the status so the session doesn't stay stuck as 'running'
        await updateSessionStatus({ id: session._id, status: 'failed' });
        throw err;
      }
      return;
    }

    // Case 3: Running session — use the normal send-message endpoint
    await sendMessage(_sid, text);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <SessionDropdown taskId={taskId} activeSessionId={sessionId} />
        {sessionStatus === 'running' && (
          <Button
            size="sm"
            variant="destructive"
            disabled={stopping}
            onClick={() => void handleStop()}
            aria-label="Stop session"
          >
            <Square className="h-3.5 w-3.5" />
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MessageStream
          events={events}
          isLoading={isLoading}
          isProcessing={sessionStatus === 'running'}
          thinkingElapsedSeconds={thinkingElapsedSeconds}
          resolvedApprovals={pendingApprovals.filter((a) => a.resolved)}
        />

        {unresolvedApprovals.length > 0 && (
          <div className="shrink-0 border-t border-border/50 bg-muted/20">
            {unresolvedApprovals.map((approval) => (
              <PermissionPrompt
                key={approval.requestId}
                approval={approval}
                onApprove={() => approve(approval.requestId)}
                onDeny={(msg) => deny(approval.requestId, msg)}
              />
            ))}
          </div>
        )}

        <UserInput
          sessionId={sessionId ?? 'new'}
          disabled={isFinished}
          queued={messageQueued}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
