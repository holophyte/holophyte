import { useQuery } from "convex/react";
import { Play, Square, Loader2 } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useAppStore } from "@/frontend/stores/app";
import { Button } from "./ui/button";

interface ClaudeButtonProps {
  task: Doc<"tasks"> & { repo?: Doc<"repos"> | null };
}

export function ClaudeButton({ task }: ClaudeButtonProps) {
  const session = useQuery(api.sessions.getByTask, { taskId: task._id });
  const openTerminal = useAppStore((s) => s.openTerminal);
  const [loading, setLoading] = useState(false);

  const handleLaunch = async () => {
    if (!task.prompt || !task.repo) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task._id,
          repoPath: task.repo.path,
          prompt: task.prompt,
        }),
      });
      const data = await res.json();
      if (data.sessionId) {
        openTerminal(data.sessionId);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    if (!session) return;
    setLoading(true);
    try {
      await fetch(`/api/sessions/${session._id}/stop`, { method: "POST" });
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

  if (session?.status === "running") {
    return (
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
        >
          <Square className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      className="w-full"
      onClick={handleLaunch}
      disabled={!task.prompt || !task.repo}
    >
      <Play className="h-4 w-4 mr-1" />
      Launch Claude Code
    </Button>
  );
}
