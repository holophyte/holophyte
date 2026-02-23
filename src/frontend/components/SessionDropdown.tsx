import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { formatTimeAgo } from '@/frontend/lib/dateUtils';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import SessionStatusDot from './SessionStatusDot';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

interface SessionDropdownProps {
  taskId: Id<'tasks'>;
  activeSessionId: string | null;
  /** Repo path needed for "new session" / resume flow */
  repoPath?: string;
}

/** Maps a session status to a human-readable label shown in the dropdown row. */
function sessionStatusLabel(status: Doc<'sessions'>['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'idle':
      return 'Idle';
    case 'failed':
      return 'Failed';
  }
}

/**
 * Popover trigger that lists all sessions for a task and lets the user switch
 * between them or start a new one.
 *
 * The trigger button shows the active session's name and a status dot. Clicking
 * it opens a popover with the full session list (ordered by `lastActivityAt`
 * desc) plus a "New session" action at the bottom.
 *
 * Data is loaded reactively from Convex via `sessions.listByTask`. The popover
 * integrates with the Zustand store: `switchSession` to change the displayed
 * session, `openSession` after creating a new one.
 */
export default function SessionDropdown({
  taskId,
  activeSessionId,
}: SessionDropdownProps) {
  const [open, setOpen] = useState(false);
  const switchSession = useAppStore((s) => s.switchSession);
  const openSession = useAppStore((s) => s.openSession);
  const createSession = useMutation(api.sessions.create);

  const sessions = useQuery(api.sessions.listByTask, { taskId });
  const activeSession = sessions?.find((s) => s._id === activeSessionId);

  const handleSelectSession = (sessionId: Id<'sessions'>) => {
    setOpen(false);
    switchSession(sessionId);
  };

  const handleNewSession = async () => {
    setOpen(false);
    const newSessionId = await createSession({ taskId });
    openSession(newSessionId);
  };

  const triggerLabel = activeSession
    ? (activeSession.name ?? `Session ${activeSession._id.slice(-6)}`)
    : 'No session';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex min-h-8 max-w-48 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-xs font-medium text-foreground hover:bg-muted/80 transition-colors"
          aria-label="Switch session"
        >
          {activeSession && <SessionStatusDot status={activeSession.status} />}
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        {sessions === undefined ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            Loading...
          </div>
        ) : sessions.length === 0 ? (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No sessions yet
          </div>
        ) : (
          <div role="listbox" aria-label="Sessions">
            {sessions.map((s) => (
              <button
                key={s._id}
                type="button"
                role="option"
                aria-selected={s._id === activeSessionId}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                  s._id === activeSessionId && 'bg-muted',
                )}
                onClick={() => handleSelectSession(s._id)}
              >
                <SessionStatusDot status={s.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.name ?? `Session ${s._id.slice(-6)}`}
                  </span>
                  <span className="block text-[10px] text-muted-foreground">
                    {sessionStatusLabel(s.status)} ·{' '}
                    {formatTimeAgo(s.lastActivityAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="mt-1 border-t border-border/50 pt-1">
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
            onClick={() => {
              void handleNewSession();
            }}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <span>New session</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
