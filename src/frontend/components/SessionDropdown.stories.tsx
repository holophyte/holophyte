import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { formatTimeAgo } from '@/frontend/lib/dateUtils';
import { cn } from '@/frontend/lib/utils';
import SessionStatusDot from './SessionStatusDot';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

// SessionDropdown directly calls useQuery(api.sessions.listByTask) and useAppStore,
// so it cannot be rendered in Storybook without a live Convex backend and store.
// These stories use a presentational replica to visualise all meaningful UI states.

type SessionStatus = 'running' | 'idle' | 'failed';

interface MockSession {
  id: string;
  name: string | null;
  status: SessionStatus;
  lastActivityAt: number;
}

interface SessionDropdownPresentationProps {
  sessions: MockSession[] | undefined;
  activeSessionId: string | null;
}

function sessionStatusLabel(status: SessionStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'idle':
      return 'Idle';
    case 'failed':
      return 'Failed';
    default:
      return 'Idle';
  }
}

/** Presentational replica of SessionDropdown used for isolated visual testing. */
function SessionDropdownPresentation({
  sessions,
  activeSessionId,
}: SessionDropdownPresentationProps) {
  const [open, setOpen] = useState(false);
  const activeSession = sessions?.find((s) => s.id === activeSessionId);

  const triggerLabel = activeSession
    ? (activeSession.name ?? `Session ${activeSession.id.slice(-6)}`)
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
                key={s.id}
                type="button"
                role="option"
                aria-selected={s.id === activeSessionId}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-muted',
                  s.id === activeSessionId && 'bg-muted',
                )}
                onClick={() => setOpen(false)}
              >
                <SessionStatusDot status={s.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {s.name ?? `Session ${s.id.slice(-6)}`}
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
            onClick={() => setOpen(false)}
          >
            <Plus className="h-3.5 w-3.5 text-muted-foreground" />
            <span>New session</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const now = Date.now();

const MOCK_SESSIONS: MockSession[] = [
  {
    id: 'abc123',
    name: 'Fix auth bug',
    status: 'running',
    lastActivityAt: now - 60_000,
  },
  {
    id: 'def456',
    name: 'Refactor sidebar',
    status: 'idle',
    lastActivityAt: now - 3_600_000,
  },
  {
    id: 'ghi789',
    name: null,
    status: 'failed',
    lastActivityAt: now - 7_200_000,
  },
];

const meta = {
  title: 'Session/SessionDropdown',
  component: SessionDropdownPresentation,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof SessionDropdownPresentation>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Trigger closed — active session is running. Click the button to open the popover. */
export const WithRunningSession: Story = {
  args: {
    sessions: MOCK_SESSIONS,
    activeSessionId: 'abc123',
  },
};

/** Trigger closed — active session is idle. */
export const WithIdleSession: Story = {
  args: {
    sessions: MOCK_SESSIONS,
    activeSessionId: 'def456',
  },
};

/** Trigger closed — active session ended with a failure. */
export const WithFailedSession: Story = {
  args: {
    sessions: MOCK_SESSIONS,
    activeSessionId: 'ghi789',
  },
};

/** No active session selected — trigger shows "No session" with no status dot. */
export const NoActiveSession: Story = {
  args: {
    sessions: MOCK_SESSIONS,
    activeSessionId: null,
  },
};

/** Task has no sessions yet — popover shows "No sessions yet" message. */
export const EmptySessions: Story = {
  args: {
    sessions: [],
    activeSessionId: null,
  },
};

/** Convex query is still in-flight — popover shows loading state. */
export const Loading: Story = {
  args: {
    sessions: undefined,
    activeSessionId: null,
  },
};
