import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { ChevronDown, ChevronUp, Circle, Wifi, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/frontend/hooks/useSession';
import { isEditableElement } from '@/frontend/lib/dom';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import MessageStream from './MessageStream';
import PermissionPrompt from './PermissionPrompt';
import UserInput from './UserInput';
import Button from './ui/Button';

interface SessionPanelProps {
  variant?: 'bottom-panel' | 'task-page';
}

function statusDot(status: string | null): { color: string; label: string } {
  switch (status) {
    case 'running':
      return { color: 'text-green-500', label: 'Running' };
    case 'waiting_input':
      return { color: 'text-amber-500', label: 'Waiting for approval' };
    case 'completed':
      return { color: 'text-muted-foreground', label: 'Completed' };
    case 'failed':
      return { color: 'text-destructive', label: 'Failed' };
    case 'stopped':
      return { color: 'text-muted-foreground', label: 'Stopped' };
    default:
      return { color: 'text-muted-foreground/50', label: 'Connecting…' };
  }
}

/**
 * Session stream pane with pinned permission prompts + input.
 *
 * - `bottom-panel` renders the existing board drawer with local header controls.
 * - `task-page` renders an embedded full-height panel for the dedicated task view.
 */
export default function SessionPanel({
  variant = 'bottom-panel',
}: SessionPanelProps) {
  const sessionId = useAppStore((s) => s.sessionId);
  const sessionMinimized = useAppStore((s) => s.sessionMinimized);
  const closeSession = useAppStore((s) => s.closeSession);
  const toggleSessionMinimized = useAppStore((s) => s.toggleSessionMinimized);

  // Close the panel when the underlying session has been deleted (e.g. repo cascade delete)
  const session = useQuery(
    api.sessions.get,
    sessionId ? { id: sessionId as Id<'sessions'> } : 'skip',
  );
  useEffect(() => {
    if (session === null) {
      closeSession();
    }
  }, [session, closeSession]);

  const {
    events,
    pendingApprovals,
    sessionStatus,
    isConnected,
    messageQueued,
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
    sessionStatus === 'running' && session?.startedAt
      ? Math.max(0, Math.floor((now - session.startedAt) / 1000))
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

  const dot = statusDot(sessionStatus);
  const isFinished =
    sessionStatus === 'completed' ||
    sessionStatus === 'failed' ||
    sessionStatus === 'stopped';
  const isLoading = !isFinished && events.length === 0 && sessionId !== null;

  const showBottomPanelHeader = variant === 'bottom-panel';
  const showBody = variant === 'task-page' || !sessionMinimized;

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        showBottomPanelHeader &&
          'border-t transition-all duration-200 panel-collapse',
        showBottomPanelHeader &&
          (sessionMinimized ? 'h-10' : 'h-[60vh] min-h-80'),
        variant === 'task-page' && 'h-full',
      )}
    >
      {showBottomPanelHeader && (
        <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Circle
              className={cn('h-2 w-2 shrink-0 fill-current', dot.color)}
              aria-label={dot.label}
            />
            <span className="text-xs font-medium text-muted-foreground truncate">
              Session
              {sessionId && (
                <span className="font-mono ml-1 opacity-60">
                  {sessionId.slice(0, 8)}
                </span>
              )}
            </span>
            {!isConnected && sessionId && (
              <WifiOff className="h-3 w-3 text-muted-foreground/50 shrink-0" />
            )}
            {isConnected && (
              <Wifi className="h-3 w-3 text-muted-foreground/30 shrink-0" />
            )}
            {!sessionMinimized && (
              <span className="text-xs text-muted-foreground/60 shrink-0">
                {dot.label}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={toggleSessionMinimized}
              aria-label={
                sessionMinimized
                  ? 'Expand session panel'
                  : 'Minimize session panel'
              }
            >
              {sessionMinimized ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-11 w-11"
              onClick={closeSession}
              aria-label="Close session panel"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {showBody && (
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
            onSend={sendMessage}
          />
        </div>
      )}
    </div>
  );
}
