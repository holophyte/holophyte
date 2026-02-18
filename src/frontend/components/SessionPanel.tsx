import { ChevronDown, ChevronUp, Circle, Wifi, WifiOff, X } from 'lucide-react';
import { useSession } from '@/frontend/hooks/useSession';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import { MessageStream } from './MessageStream';
import { PermissionPrompt } from './PermissionPrompt';
import { UserInput } from './UserInput';
import Button from './ui/Button';

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
 * The bottom pane of the Holophyte layout that replaces the xterm.js
 * `TerminalPanel`. It renders the active Claude Code session as a structured
 * conversation UI rather than raw ANSI output.
 *
 * Reads the active session ID and panel collapse state from the Zustand app
 * store, then delegates to {@link useSession} for WebSocket management and
 * event state. Child components:
 *
 * - {@link MessageStream} — scrollable event/message view
 * - {@link PermissionPrompt} — stacked cards for unresolved tool-use approvals
 * - {@link UserInput} — follow-up message input bar
 *
 * No props — all state is sourced from the global store.
 */
export function SessionPanel() {
  const sessionId = useAppStore((s) => s.sessionId);
  const sessionMinimized = useAppStore((s) => s.sessionMinimized);
  const closeSession = useAppStore((s) => s.closeSession);
  const toggleSessionMinimized = useAppStore((s) => s.toggleSessionMinimized);

  const {
    events,
    pendingApprovals,
    sessionStatus,
    isConnected,
    approve,
    deny,
    sendMessage,
  } = useSession(sessionId);

  const dot = statusDot(sessionStatus);
  const isFinished =
    sessionStatus === 'completed' ||
    sessionStatus === 'failed' ||
    sessionStatus === 'stopped';
  const isLoading = !isFinished && events.length === 0 && sessionId !== null;
  const unresolvedApprovals = pendingApprovals.filter((a) => !a.resolved);

  return (
    <div
      className={cn(
        'border-t bg-background flex flex-col transition-all duration-200',
        sessionMinimized ? 'h-10' : 'h-[40vh] min-h-64',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Circle className={cn('h-2 w-2 shrink-0 fill-current', dot.color)} />
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
            className="h-6 w-6"
            onClick={toggleSessionMinimized}
            aria-label={
              sessionMinimized
                ? 'Expand session panel'
                : 'Minimize session panel'
            }
          >
            {sessionMinimized ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={closeSession}
            aria-label="Close session panel"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Body */}
      {!sessionMinimized && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <MessageStream events={events} isLoading={isLoading} />

          {/* Permission prompts stacked above input */}
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
            onSend={sendMessage}
          />
        </div>
      )}
    </div>
  );
}
