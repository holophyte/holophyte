import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/frontend/hooks/useSession';
import { useAppStore } from '@/frontend/stores/app';
import SessionDropdown from './SessionDropdown';
import SessionRuntimeProvider from './session/SessionRuntimeProvider';
import SessionThread from './session/SessionThread';
import {
  BashToolUI,
  EditToolUI,
  GenericToolUI,
  GlobToolUI,
  GrepToolUI,
  ReadToolUI,
  WebFetchToolUI,
  WebSearchToolUI,
  WriteToolUI,
} from './session/toolUIs';
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
  const resumeSessionMutation = useMutation(api.sessions.resumeSession);
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

  // Single useSession call — state is passed down to SessionRuntimeProvider as props
  // to avoid duplicate WebSocket connections.
  const {
    events,
    pendingApprovals,
    sessionStatus,
    sdkSessionId,
    reconnectWs,
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

  /**
   * Handle sending a message. Covers three cases:
   * 1. No session — create a new one and start it with the given prompt.
   * 2. Idle session — resume the existing session in-place.
   * 3. Running session — forward the message via WebSocket (handled by SessionRuntimeProvider).
   */
  const handleNewSession = async (text: string) => {
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
      // Atomic guard: only one tab can transition idle → running
      const result = await resumeSessionMutation({ id: session._id });
      if (!result.ok) {
        // Another tab already resumed this session — silently bail out.
        return;
      }

      try {
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
        // Reconnect the WebSocket so it picks up the new server-side session
        reconnectWs();
      } catch (err) {
        // Revert the status so the session doesn't stay stuck as 'running'
        try {
          await updateSessionStatus({ id: session._id, status: 'idle' });
        } catch (cleanupErr) {
          console.error('Failed to revert session status:', cleanupErr);
        }
        throw err;
      }
    }
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

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {sessionId ? (
          <SessionRuntimeProvider
            sessionId={sessionId}
            events={events}
            pendingApprovals={pendingApprovals}
            sessionStatus={sessionStatus}
            approve={approve}
            deny={deny}
            sendMessage={sendMessage}
          >
            <BashToolUI />
            <ReadToolUI />
            <EditToolUI />
            <WriteToolUI />
            <GlobToolUI />
            <GrepToolUI />
            <WebFetchToolUI />
            <WebSearchToolUI />
            <GenericToolUI />
            <SessionThread />
          </SessionRuntimeProvider>
        ) : (
          <NoSessionPlaceholder
            taskPath={task?.repo?.path ?? ''}
            onStart={handleNewSession}
          />
        )}
      </div>
    </div>
  );
}

interface NoSessionPlaceholderProps {
  taskPath: string;
  onStart: (text: string) => Promise<void>;
}

function NoSessionPlaceholder({
  taskPath,
  onStart,
}: NoSessionPlaceholderProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSend = async () => {
    if (!text.trim() || !taskPath) return;
    setSending(true);
    setError(null);
    try {
      await onStart(text.trim());
      setText('');
    } catch {
      setError('Failed to start session. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4">
      <p className="text-sm text-muted-foreground">
        No active session. Start one by sending a prompt.
      </p>
      <div className="w-full max-w-lg space-y-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What would you like Claude to do?"
          rows={3}
          disabled={sending || !taskPath}
          className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button
          className="w-full"
          disabled={!text.trim() || sending || !taskPath}
          onClick={() => void handleSend()}
        >
          {sending ? 'Starting…' : 'Start session'}
        </Button>
      </div>
    </div>
  );
}
