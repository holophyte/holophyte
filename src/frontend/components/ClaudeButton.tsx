import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { useMutation, useQuery } from 'convex/react';
import { Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';
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
  const updateSessionStatus = useMutation(api.sessions.updateStatus);
  const openSession = useAppStore((s) => s.openSession);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);

  const handleLaunch = async () => {
    if (!task.prompt || !task.repo) return;
    setLoading(true);
    setError(null);
    let sessionId: Id<'sessions'> | undefined;
    try {
      // Create session in Convex first (frontend has auth context)
      sessionId = await createSession({ taskId: task._id });

      // Then start the SDK session on the server
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          repoPath: task.repo.path,
          prompt: task.prompt,
          model,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        await updateSessionStatus({ id: sessionId, status: 'failed' });
        setError(data.error ?? 'Failed to launch session');
        return;
      }
      openSession(sessionId);
    } catch (err) {
      setError(String(err));
      if (sessionId) {
        await updateSessionStatus({ id: sessionId, status: 'failed' });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session._id}/stop`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to stop session');
      }
      // Fallback: if session panel is closed, the exit event has no subscriber.
      // Safe to call unconditionally — the mutation is idempotent.
      await updateSessionStatus({ id: session._id, status: 'stopped' });
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

  if (session?.status === 'running') {
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
            View Session
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
          disabled={!task.prompt || !task.repo}
        >
          <Play className="h-4 w-4 mr-1" />
          Launch Claude Code
        </Button>
        <ModelPicker value={model} onChange={setModel} />
      </div>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </>
  );
}
