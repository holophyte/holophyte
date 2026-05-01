import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { QUEUED_WARNING_THRESHOLD_MS } from '@/constants';
import { useHolophyteChat } from '@/frontend/hooks/useHolophyteChat';
import {
  type LaunchDefaults,
  useLaunchDefaults,
} from '@/frontend/hooks/useLaunchDefaults';
import { useSession } from '@/frontend/hooks/useSession';
import { toast } from '@/frontend/lib/toast';
import { useAppStore } from '@/frontend/stores/app';
import EffortPicker, {
  defaultEffortFor,
  resolveEffortFor,
} from './EffortPicker';
import ProviderModelPicker, {
  type ProviderModelValue,
} from './ProviderModelPicker';
import SessionDropdown from './SessionDropdown';
import { SessionActionsProvider } from './session/SessionActionsContext';
import SessionThread from './session/SessionThread';
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

  const {
    events,
    pendingApprovals,
    sessionStatus,
    projectCommands,
    approve,
    deny,
    sendMessage,
    messageQueued,
  } = useSession(sessionId);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (sessionStatus !== 'queued') return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [sessionStatus]);

  const queuedWarning = useMemo(() => {
    if (sessionStatus !== 'queued' || !session) return null;
    const queuedSince = session.lastActivityAt ?? session.startedAt;
    if (now - queuedSince >= QUEUED_WARNING_THRESHOLD_MS) {
      return 'Session is waiting for the companion to come online. Start the Holophyte server to pick it up.';
    }
    return null;
  }, [sessionStatus, session, now]);

  const handleStopRaw = useCallback(async () => {
    if (!sessionId) return;
    await requestStop({ id: sessionId as Id<'sessions'> });
  }, [sessionId, requestStop]);

  const resumeIdleSession = useCallback(
    async (text: string, reasoningEffort?: string) => {
      if (!session) throw new Error('No session to resume');

      const result = await queueResume({
        id: session._id,
        prompt: text,
        reasoningEffort,
      });
      if (!result.ok)
        throw new Error(
          'Session is no longer idle (resumed from another tab?)',
        );
    },
    [session, queueResume],
  );

  const handleSendMessage = useCallback(
    async (sid: string, text: string, reasoningEffort?: string) => {
      if (sessionStatus === 'idle') {
        await resumeIdleSession(text, reasoningEffort);
        return;
      }
      if (sessionStatus === 'running' || sessionStatus === 'queued') {
        await sendMessage(sid, text, reasoningEffort);
        return;
      }
      console.error(
        '[SessionPanel] handleSendMessage called in unexpected status:',
        sessionStatus,
      );
    },
    [sessionStatus, resumeIdleSession, sendMessage],
  );

  /** Create a brand-new session (used by NoSessionPlaceholder). */
  const handleNewSession = async (text: string, pick: LaunchDefaults) => {
    if (!task?.repo?.path) return;
    const newSessionId = await createSession({
      taskId,
      prompt: text,
      model: pick.model,
      provider: pick.provider,
      reasoningEffort: pick.effort === 'auto' ? undefined : pick.effort,
    });
    openSession(newSessionId);
  };

  const sessionProvider: 'claude' | 'codex' = session?.provider ?? 'claude';

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/50 px-3 py-2">
        <SessionDropdown taskId={taskId} activeSessionId={sessionId} />
        {sessionId && (
          <ProviderBadge provider={sessionProvider} model={session?.model} />
        )}
      </div>

      {queuedWarning && (
        <div className="shrink-0 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs text-yellow-400">
          {queuedWarning}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {sessionId ? (
          <ActiveSession
            key={sessionId}
            sessionId={sessionId}
            sessionProvider={sessionProvider}
            events={events}
            pendingApprovals={pendingApprovals}
            sessionStatus={sessionStatus}
            projectCommands={projectCommands}
            approve={approve}
            deny={deny}
            sendMessage={handleSendMessage}
            handleStop={handleStopRaw}
            messageQueued={messageQueued}
          />
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

// ---------------------------------------------------------------------------
// ProviderBadge — small pill shown in the active session header
// ---------------------------------------------------------------------------

function ProviderBadge({
  provider,
  model,
}: {
  provider: 'claude' | 'codex';
  model?: string;
}) {
  const label = provider === 'codex' ? 'Codex' : 'Claude';
  return (
    <span
      className="ml-1 rounded-full border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      title={model ? `${label} · ${model}` : label}
    >
      <span className="sr-only">Provider: </span>
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ActiveSession — calls useHolophyteChat and provides context to SessionThread
// ---------------------------------------------------------------------------

interface ActiveSessionProps {
  sessionId: string;
  sessionProvider: 'claude' | 'codex';
  events: ReturnType<typeof useSession>['events'];
  pendingApprovals: ReturnType<typeof useSession>['pendingApprovals'];
  sessionStatus: ReturnType<typeof useSession>['sessionStatus'];
  projectCommands: ReturnType<typeof useSession>['projectCommands'];
  approve: ReturnType<typeof useSession>['approve'];
  deny: ReturnType<typeof useSession>['deny'];
  sendMessage: (
    sessionId: string,
    text: string,
    reasoningEffort?: string,
  ) => Promise<void>;
  handleStop: () => Promise<void>;
  messageQueued: boolean;
}

function ActiveSession({
  sessionId,
  sessionProvider,
  events,
  pendingApprovals,
  sessionStatus,
  projectCommands,
  approve,
  deny,
  sendMessage,
  handleStop,
  messageQueued,
}: ActiveSessionProps) {
  // Per-active-session effort. The composer is the source of truth for the
  // *next* turn's effort, but we only transmit a value when the user has
  // explicitly changed the picker — otherwise the manager keeps the existing
  // session-level effort (set at launch or by a prior follow-up). Seed the
  // displayed value from `useLaunchDefaults` so the picker shows the most
  // likely current setting (the value the user last launched with for this
  // provider). The frontend has no read-back of the manager's actual current
  // effort because effort is intentionally not a persisted session property.
  const { defaults } = useLaunchDefaults();
  const initialEffort =
    defaults.provider === sessionProvider
      ? defaults.effort
      : defaultEffortFor(sessionProvider);
  const [effort, setEffortState] = useState<string>(initialEffort);
  const [effortDirty, setEffortDirty] = useState(false);

  const setEffort = useCallback((next: string) => {
    setEffortState(next);
    setEffortDirty(true);
  }, []);

  // Wrap sendMessage so effort is only forwarded when the user has explicitly
  // changed it this session. Untouched picker → undefined → manager preserves
  // the existing session-level effort. When the user explicitly picks Claude's
  // `'auto'`, we still transmit it so the manager can clear a prior override
  // (otherwise a session running at e.g. `'high'` could never return to
  // adaptive thinking once changed).
  const sendMessageWrapped = useCallback(
    (sid: string, text: string, _reasoningEffort?: string) => {
      const value = effortDirty ? effort : undefined;
      return sendMessage(sid, text, value);
    },
    [sendMessage, effort, effortDirty],
  );

  const chat = useHolophyteChat({
    sessionId,
    events,
    pendingApprovals,
    sessionStatus,
    projectCommands,
    approve,
    deny,
    sendMessage: sendMessageWrapped,
    handleStop,
    messageQueued,
  });

  return (
    <SessionActionsProvider
      approve={chat.approve}
      deny={chat.deny}
      pendingApprovals={chat.pendingApprovals}
      sessionStatus={chat.sessionStatus}
      promptSuggestion={chat.promptSuggestion}
      availableCommands={chat.availableCommands}
      handleStop={chat.stop}
      messageQueued={chat.messageQueued}
      sendMessage={chat.sendMessage}
      provider={sessionProvider}
      effort={effort}
      setEffort={setEffort}
    >
      <SessionThread
        messages={chat.messages}
        status={chat.status}
        isInterrupted={chat.isInterrupted}
      />
    </SessionActionsProvider>
  );
}

// ---------------------------------------------------------------------------
// NoSessionPlaceholder
// ---------------------------------------------------------------------------

interface NoSessionPlaceholderProps {
  taskPath: string;
  taskPrompt?: string;
  onStart: (text: string, pick: LaunchDefaults) => Promise<void>;
}

function NoSessionPlaceholder({
  taskPath,
  taskPrompt,
  onStart,
}: NoSessionPlaceholderProps) {
  const { defaults, save } = useLaunchDefaults();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pick, setPick] = useState<LaunchDefaults>(defaults);

  // Pre-fill text from the task prompt when it arrives from Convex, but only
  // if the user hasn't started typing. Derived-state-without-useEffect.
  const [prevPrompt, setPrevPrompt] = useState<string | undefined>(undefined);
  if (taskPrompt !== prevPrompt) {
    setPrevPrompt(taskPrompt);
    if (taskPrompt && text === '') {
      setText(taskPrompt);
    }
  }

  const handleProviderModelChange = useCallback((next: ProviderModelValue) => {
    setPick((prev) =>
      next.provider === prev.provider
        ? { ...prev, model: next.model }
        : {
            provider: next.provider,
            model: next.model,
            effort: resolveEffortFor(next.provider),
          },
    );
  }, []);

  const handleSend = async () => {
    if (!text.trim() || !taskPath) return;
    setSending(true);
    try {
      save(pick);
      await onStart(text.trim(), pick);
      setText('');
    } catch {
      toast.error('Failed to start session. Try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">
          Send a message to start the conversation.
        </p>
      </div>
      <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What would you like to do?"
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
        <div className="mt-2 flex items-center gap-2">
          <ProviderModelPicker
            value={{ provider: pick.provider, model: pick.model }}
            onChange={handleProviderModelChange}
            disabled={sending}
          />
          <EffortPicker
            provider={pick.provider}
            value={pick.effort}
            onChange={(effort) => setPick({ ...pick, effort })}
          />
          <Button
            className="ml-auto"
            disabled={!text.trim() || sending || !taskPath}
            onClick={() => void handleSend()}
          >
            {sending ? 'Starting…' : 'Send'}
          </Button>
        </div>
      </div>
    </div>
  );
}
