import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Terminal } from "lucide-react";
import { cn } from "@/frontend/lib/utils";
import { useAppStore } from "@/frontend/stores/app";
import { Badge } from "./ui/badge";

interface TaskCardProps {
  task: Doc<"tasks">;
  repoName?: string;
}

export function TaskCard({ task, repoName }: TaskCardProps) {
  const selectTask = useAppStore((s) => s.selectTask);
  const session = useQuery(api.sessions.getByTask, { taskId: task._id });

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onClick={() => selectTask(task._id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          selectTask(task._id);
        }
      }}
      className={cn(
        "bg-background rounded-md border p-3 cursor-pointer hover:border-foreground/20 transition-colors shadow-sm",
        "active:cursor-grabbing",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug">{task.title}</h3>
        {session?.status === "running" && (
          <Terminal className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
        )}
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-2">
        {repoName && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {repoName}
          </Badge>
        )}
        {task.prompt && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            prompt
          </Badge>
        )}
        {session && (
          <Badge
            variant={session.status === "running" ? "default" : "outline"}
            className={cn(
              "text-[10px] px-1.5 py-0",
              session.status === "completed" && "text-green-600",
              session.status === "failed" && "text-red-600",
              session.status === "stopped" && "text-yellow-600",
            )}
          >
            {session.status}
          </Badge>
        )}
      </div>
    </div>
  );
}
