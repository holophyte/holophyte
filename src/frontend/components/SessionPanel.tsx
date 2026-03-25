import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_MODEL, QUEUED_WARNING_THRESHOLD_MS } from '@/constants';
import { useSession } from '@/frontend/hooks/useSession';
import { useAppStore } from '@/frontend/stores/app';
import type { ClaudeModelId } from './ModelPicker';
import ModelPicker from './ModelPicker';
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
  const requestStop = useMutation(api.sessions.requestStop);
  const queueResume = useMutation(api.sessions.queueResume);
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
    approve,
    deny,
    sendMessage: sessionSendMessage,
  } = useSession(sessionId);

  const [now, setNow] = useState(() => Date.now());

  // Tick every second while the session is queued to keep the warning fresh.
  useEffect(() => {
    if (sessionStatus !== 'queued') return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sessionStatus]);

  // Show a warning after the session has been queued longer than the threshold.
  const queuedWarning = useMemo(() => {
    if (sessionStatus !== 'queued' || !session) return null;
    const queuedSince = session.lastActivityAt ?? session.startedAt;
    if (now - queuedSince >= QUEUED_WARNING_THRESHOLD_MS) {
      return 'Session is waiting for the companion to come online. Start the Holophyte server to pick it up.';
    }
    return null;
  }, [sessionStatus, session, now]);

  const handleStop = useCallback(async () => {
    if (!sessionId) return;
    try {
      await requestStop({ id: sessionId as Id<'sessions'> });
    } catch (err) {
      console.error('Failed to stop session:', err);
    }
  }, [sessionId, requestStop]);

  /** Resume an idle session by queuing it with a new prompt. */
  const resumeIdleSession = useCallback(
    async (text: string) => {
      if (!session) throw new Error('No session to resume');

      const result = await queueResume({ id: session._id, prompt: text });
      if (!result.ok)
        throw new Error(
          'Session is no longer idle (resumed from another tab?)',
        );
    },
    [session, queueResume],
  );

  /**
   * Unified send handler passed to SessionRuntimeProvider.
   * - idle: resumes the session with a new prompt
   * - running/queued: queues a follow-up message for delivery to the SDK
   */
  const handleSendMessage = useCallback(
    async (sid: string, text: string) => {
      if (sessionStatus === 'idle') {
        await resumeIdleSession(text);
      } else if (sessionStatus === 'running' || sessionStatus === 'queued') {
        await sessionSendMessage(sid, text);
      }
    },
    [sessionStatus, resumeIdleSession, sessionSendMessage],
  );

  /** Create a brand-new session (used by NoSessionPlaceholder). */
  const handleNewSession = async (text: string, model: ClaudeModelId) => {
    if (!task?.repo?.path) return;
    // Create session in Convex with 'queued' status — the companion picks it up
    const newSessionId = await createSession({
      taskId,
      prompt: text,
      model,
    });
    openSession(newSessionId);
  };

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <SessionDropdown taskId={taskId} activeSessionId={sessionId} />
      </div>

      {queuedWarning && (
        <div className="shrink-0 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-400">
          {queuedWarning}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {sessionId ? (
          <SessionRuntimeProvider
            sessionId={sessionId}
            events={events}
            pendingApprovals={pendingApprovals}
            sessionStatus={sessionStatus}
            approve={approve}
            deny={deny}
            requestStop={handleStop}
            sendMessage={handleSendMessage}
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
            key={taskId}
            taskPath={task?.repo?.path ?? ''}
            taskPrompt={task?.prompt}
            onStart={handleNewSession}
          />
        )}
      </div>
    </div>
  );
}

interface NoSessionPlaceholderProps {
  taskPath: string;
  taskPrompt?: string;
  onStart: (text: string, model: ClaudeModelId) => Promise<void>;
}

function NoSessionPlaceholder({
  taskPath,
  taskPrompt,
  onStart,
}: NoSessionPlaceholderProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);

  // Pre-fill text from the task prompt when it arrives from Convex, but only if
  // the user hasn't started typing. Uses derived-state-without-useEffect pattern.
  const [prevPrompt, setPrevPrompt] = useState<string | undefined>(undefined);
  if (taskPrompt !== prevPrompt) {
    setPrevPrompt(taskPrompt);
    if (taskPrompt && text === '') {
      setText(taskPrompt);
    }
  }

  const handleSend = async () => {
    if (!text.trim() || !taskPath) return;
    setSending(true);
    setError(null);
    try {
      await onStart(text.trim(), model);
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
        <div className="flex items-center gap-2">
          <Button
            className="flex-1"
            disabled={!text.trim() || sending || !taskPath}
            onClick={() => void handleSend()}
          >
            {sending ? 'Starting…' : 'Start session'}
          </Button>
          <ModelPicker value={model} onChange={setModel} />
        </div>
      </div>
    </div>
  );
}
