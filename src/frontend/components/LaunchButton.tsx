import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useMatch, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { AlertTriangle, Loader2, Play, Square } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useCompanionStatus } from '@/frontend/hooks/useCompanionStatus';
import {
  resolvePermissionModeFor,
  useLaunchDefaults,
} from '@/frontend/hooks/useLaunchDefaults';
import { useStickyValue } from '@/frontend/hooks/useStickyValue';
import { toast } from '@/frontend/lib/toast';
import { useAppStore } from '@/frontend/stores/app';
import type { PermissionMode } from '@/permissionMode';
import EffortPicker, { resolveEffortFor } from './EffortPicker';
import PermissionModePicker from './PermissionModePicker';
import ProviderModelPicker, {
  type ProviderModelValue,
} from './ProviderModelPicker';
import Button from './ui/Button';

interface LaunchButtonProps {
  task: Doc<'tasks'> & { repo?: Doc<'repos'> | null };
}

/**
 * Launch / resume / stop button for a task's session.
 *
 * Renders a provider+model picker and an effort picker beside the launch
 * button when the task has a stored prompt, so the user can choose what to
 * launch with before queueing the first turn. Without a stored prompt,
 * navigates to the task page so the in-panel composer can collect one.
 */
export function LaunchButton({ task }: LaunchButtonProps) {
  const session = useStickyValue(
    useQuery(api.sessions.getByTask, { taskId: task._id }),
    task._id,
  );
  const createSession = useMutation(api.sessions.create);
  const requestStop = useMutation(api.sessions.requestStop);
  const openSession = useAppStore((s) => s.openSession);
  const closeSession = useAppStore((s) => s.closeSession);
  const navigate = useNavigate();
  const taskPageMatch = useMatch({
    from: '/repos/$repoId/tasks/$taskId/page',
    shouldThrow: false,
  });
  const { defaults, save } = useLaunchDefaults();
  const [loading, setLoading] = useState(false);
  const [pick, setPick] = useState<{
    provider: 'claude' | 'codex';
    model: string;
    effort: string;
    permissionMode: PermissionMode;
  }>(defaults);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const { state: companionState } = useCompanionStatus(selectedOrgId);

  const isOnThisTaskPage =
    taskPageMatch?.params.taskId === task._id &&
    taskPageMatch?.params.repoId === String(task.repoId);

  const handleProviderModelChange = useCallback((next: ProviderModelValue) => {
    setPick((prev) =>
      next.provider === prev.provider
        ? { ...prev, model: next.model }
        : {
            provider: next.provider,
            model: next.model,
            effort: resolveEffortFor(next.provider),
            permissionMode: resolvePermissionModeFor(next.provider),
          },
    );
  }, []);

  const handleLaunch = async () => {
    if (!task.repo) return;

    if (task.prompt) {
      setLoading(true);
      try {
        save(pick);
        const sessionId = await createSession({
          taskId: task._id,
          prompt: task.prompt,
          model: pick.model,
          provider: pick.provider,
          reasoningEffort: pick.effort === 'auto' ? undefined : pick.effort,
          permissionMode: pick.permissionMode,
        });
        openSession(sessionId);
        if (!isOnThisTaskPage) {
          void navigate({
            to: '/repos/$repoId/tasks/$taskId/page',
            params: { repoId: String(task.repoId), taskId: task._id },
          });
        }
      } catch (err) {
        toast.error(
          `Failed to launch session for "${task.title}": ${String(err)}`,
        );
      } finally {
        setLoading(false);
      }
    } else {
      closeSession();
      if (!isOnThisTaskPage) {
        void navigate({
          to: '/repos/$repoId/tasks/$taskId/page',
          params: { repoId: String(task.repoId), taskId: task._id },
        });
      }
    }
  };

  const handleStop = async () => {
    if (!session) return;
    setLoading(true);
    try {
      await requestStop({ id: session._id });
      toast.success(`Stop requested for "${task.title}"`);
    } catch (err) {
      toast.error(`Failed to stop session for "${task.title}": ${String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = () => {
    if (session) {
      openSession(session._id);
    }
  };

  if (loading) {
    return (
      <Button size="sm" disabled className="w-full">
        <Loader2 className="h-4 w-4 animate-spin mr-1" />
        Working...
      </Button>
    );
  }

  if (session?.status === 'running' || session?.status === 'queued') {
    return (
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          onClick={handleResume}
        >
          <Play className="h-4 w-4 mr-1" />
          {session.status === 'queued' ? 'Queued…' : 'View Session'}
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleStop}
          aria-label="Stop session"
          title="Stop session"
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <div className="flex gap-2 items-center">
        <Button
          size="sm"
          className="flex-1"
          onClick={handleLaunch}
          disabled={!task.repo || companionState === 'loading'}
        >
          <Play className="h-4 w-4 mr-1" />
          Launch session
        </Button>
        {task.prompt && (
          <>
            <ProviderModelPicker
              value={{ provider: pick.provider, model: pick.model }}
              onChange={handleProviderModelChange}
            />
            <EffortPicker
              provider={pick.provider}
              value={pick.effort}
              onChange={(effort) => setPick({ ...pick, effort })}
            />
            <PermissionModePicker
              value={pick.permissionMode}
              onChange={(permissionMode) =>
                setPick({ ...pick, permissionMode })
              }
            />
          </>
        )}
      </div>
      {(companionState === 'offline' || companionState === 'stale') && (
        <p className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {companionState === 'offline'
            ? "Companion offline — task will queue but won't start until it reconnects."
            : 'Companion connection is stale — task may be delayed.'}
        </p>
      )}
    </>
  );
}
