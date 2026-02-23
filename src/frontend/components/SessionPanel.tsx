import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useState } from 'react';
import { useSession } from '@/frontend/hooks/useSession';
import { isEditableElement } from '@/frontend/lib/dom';
import { useAppStore } from '@/frontend/stores/app';
import MessageStream from './MessageStream';
import PermissionPrompt from './PermissionPrompt';
import SessionDropdown from './SessionDropdown';
import UserInput from './UserInput';

/**
 * Full-height session stream pane with pinned permission prompts + input.
 * Rendered inside the dedicated task page view.
 */
export default function SessionPanel() {
  const sessionId = useAppStore((s) => s.activeSessionId);
  const openSession = useAppStore((s) => s.openSession);
  const closeSession = useAppStore((s) => s.closeSession);
  const createSession = useMutation(api.sessions.create);
  const updateSessionStatus = useMutation(api.sessions.updateStatus);

  // Load the session record so we can access taskId, sdkSessionId, etc.
  const session = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<'sessions'> } : 'skip',
  );

  // Load the task (with repo) so we have repoPath for the resume flow
  const task = useQuery(
    api.tasks.get,
    session?.taskId ? { id: session.taskId } : 'skip',
  );

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
   * Handle sending a message. For idle sessions, this creates a new Convex
   * session and resumes the SDK conversation with the user's text as the prompt.
   * On any failure, the newly created session record is marked 'failed' so it
   * doesn't orphan as 'running' with no backend process.
   */
  const handleSend = async (_sid: string, text: string) => {
    // If session is idle and we have a sdkSessionId + repoPath, resume via new session
    if (
      sessionStatus === 'idle' &&
      session?.taskId &&
      sdkSessionId &&
      task?.repo?.path
    ) {
      let newSessionId: Id<'sessions'> | undefined;
      try {
        newSessionId = await createSession({ taskId: session.taskId });
        const res = await fetch('/api/sessions/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: newSessionId,
            repoPath: task.repo.path,
            prompt: text,
            resumeSdkSessionId: sdkSessionId,
          }),
        });
        if (!res.ok) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? 'Failed to resume session');
        }
        openSession(newSessionId);
      } catch (err) {
        // Clean up the orphaned Convex record — no backend process was started
        if (newSessionId) {
          await updateSessionStatus({ id: newSessionId, status: 'failed' });
        }
        throw err;
      }
      return;
    }
    // For running sessions, use the normal send-message endpoint
    await sendMessage(_sid, text);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      {session?.taskId && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
          <SessionDropdown
            taskId={session.taskId}
            activeSessionId={sessionId}
          />
        </div>
      )}
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
          sessionId={sessionId}
          disabled={!sessionId || isFinished}
          queued={messageQueued}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
