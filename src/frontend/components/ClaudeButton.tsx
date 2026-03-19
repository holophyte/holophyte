import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useMatch, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { AlertTriangle, Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useCompanionStatus } from '@/frontend/hooks/useCompanionStatus';
import { useStickyValue } from '@/frontend/hooks/useStickyValue';
import { useAppStore } from '@/frontend/stores/app';
import type { ClaudeModelId } from './ModelPicker';
import ModelPicker, { DEFAULT_MODEL } from './ModelPicker';
import Button from './ui/Button';

interface ClaudeButtonProps {
  task: Doc<'tasks'> & { repo?: Doc<'repos'> | null };
}

export function ClaudeButton({ task }: ClaudeButtonProps) {
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);
  const [prevTaskId, setPrevTaskId] = useState(task._id);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const { state: companionState } = useCompanionStatus(selectedOrgId);

  // Reset model to default when switching to a different task
  if (task._id !== prevTaskId) {
    setPrevTaskId(task._id);
    setModel(DEFAULT_MODEL);
  }

  const handleLaunch = async () => {
    setError(null);
    if (!task.repo) return;

    if (task.prompt) {
      // Has prompt: create + queue session immediately
      setLoading(true);
      try {
        // Create session in Convex with 'queued' status — the companion picks it up
        const sessionId = await createSession({
          taskId: task._id,
          prompt: task.prompt,
          model,
        });
        openSession(sessionId);
        // Navigate to task page after launching, unless already there
        if (!taskPageMatch) {
          void navigate({
            to: '/repos/$repoId/tasks/$taskId/page',
            params: { repoId: String(task.repoId), taskId: task._id },
          });
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    } else {
      // No prompt: navigate to task page for chat-first flow
      if (!taskPageMatch) {
        // Clear any stale active session that belongs to a different task
        closeSession();
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
    setError(null);
    try {
      await requestStop({ id: session._id });
    } catch (err) {
      setError(String(err));
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
      <>
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
          <Button size="sm" variant="destructive" onClick={handleStop}>
            <Square className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </>
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
          Launch Claude Code
        </Button>
        <ModelPicker value={model} onChange={setModel} />
      </div>
      {(companionState === 'offline' || companionState === 'stale') && (
        <p className="text-xs text-yellow-600 mt-1 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          {companionState === 'offline'
            ? "Companion offline \u2014 task will queue but won't start until it reconnects."
            : 'Companion connection is stale \u2014 task may be delayed.'}
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </>
  );
}
