import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation } from 'convex/react';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useCallback } from 'react';
import type { SessionExitEvent } from '@/claude/manager';
import { useTerminal } from '@/frontend/hooks/useTerminal';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';

export function TerminalPanel() {
  const terminalSessionId = useAppStore((s) => s.terminalSessionId);
  const terminalMinimized = useAppStore((s) => s.terminalMinimized);
  const closeTerminal = useAppStore((s) => s.closeTerminal);
  const toggleTerminalMinimized = useAppStore((s) => s.toggleTerminalMinimized);
  const updateSessionStatus = useMutation(api.sessions.updateStatus);

  const handleSessionExit = useCallback(
    (event: SessionExitEvent) => {
      if (!terminalSessionId) return;
      updateSessionStatus({
        id: terminalSessionId as Id<'sessions'>,
        status: event.status,
      });
    },
    [terminalSessionId, updateSessionStatus],
  );

  const terminalRef = useTerminal({
    sessionId: terminalSessionId,
    onSessionExit: handleSessionExit,
  });

  return (
    <div
      className={cn(
        'border-t bg-background flex flex-col transition-all',
        terminalMinimized ? 'h-10' : 'h-80',
      )}
    >
      <div className="flex items-center justify-between px-3 py-1 border-b bg-muted/50">
        <span className="text-xs font-medium text-muted-foreground">
          Terminal — {terminalSessionId?.slice(0, 8)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={toggleTerminalMinimized}
            aria-label={
              terminalMinimized ? 'Expand terminal' : 'Minimize terminal'
            }
          >
            {terminalMinimized ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={closeTerminal}
            aria-label="Close terminal"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {!terminalMinimized && (
        <div ref={terminalRef} className="flex-1 bg-black" />
      )}
    </div>
  );
}
