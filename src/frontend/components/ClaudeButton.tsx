import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { Loader2, Play, Square } from 'lucide-react';
import { useState } from 'react';
import { useStickyValue } from '@/frontend/hooks/useStickyValue';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';

interface ClaudeButtonProps {
  task: Doc<'tasks'> & { repo?: Doc<'repos'> | null };
}

export function ClaudeButton({ task }: ClaudeButtonProps) {
  const session = useStickyValue(
    useQuery(api.sessions.getByTask, { taskId: task._id }),
    task._id,
  );
  const openTerminal = useAppStore((s) => s.openTerminal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLaunch = async () => {
    if (!task.prompt || !task.repo) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sessions/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task._id,
          repoPath: task.repo.path,
          prompt: task.prompt,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? 'Failed to launch session');
        return;
      }
      const data = await res.json();
      if (data.sessionId) {
        openTerminal(data.sessionId);
      }
    } catch (err) {
      setError(String(err));
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
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleResume = () => {
    if (session) {
      openTerminal(session._id);
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
            View Terminal
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={handleStop}
            aria-label="Stop session"
          >
            <Square className="h-4 w-4" />
          </Button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </>
    );
  }

  return (
    <>
      <Button
        size="sm"
        className="w-full"
        onClick={handleLaunch}
        disabled={!task.prompt || !task.repo}
      >
        <Play className="h-4 w-4 mr-1" />
        Launch Claude Code
      </Button>
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </>
  );
}
