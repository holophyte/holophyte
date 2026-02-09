import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { CheckSquare, Clock, Terminal } from "lucide-react";
import { formatRelativeDate } from "@/frontend/lib/date-utils";
import { cn } from "@/frontend/lib/utils";
import { useAppStore } from "@/frontend/stores/app";
import type { EnrichedTask } from "./KanbanBoard";
import { Badge } from "./ui/badge";

interface TaskCardProps {
  task: EnrichedTask;
  repoName?: string;
}

export function TaskCard({ task, repoName }: TaskCardProps) {
  const selectTask = useAppStore((s) => s.selectTask);
  const session = useQuery(api.sessions.getByTask, { taskId: task._id });

  const isOverdue =
    task.dueAt &&
    task.dueAt < Date.now() &&
    task.status !== "done" &&
    task.status !== "archived";

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData("text/plain", task._id);
    e.dataTransfer.setData("application/x-status", task.status);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      data-task-id={task._id}
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
      {/* Label color dots */}
      {task.labels && task.labels.length > 0 && (
        <div className="flex gap-1 mb-1.5">
          {task.labels.map((label) => (
            <span
              key={label._id}
              className="h-1.5 w-6 rounded-full"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
        </div>
      )}
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
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
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
        {task.subtaskTotal > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
            <CheckSquare className="h-2.5 w-2.5" />
            {task.subtaskCompleted}/{task.subtaskTotal}
          </Badge>
        )}
        {task.dueAt && (
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] px-1.5 py-0 gap-0.5",
              isOverdue && "text-red-600 border-red-300 bg-red-50",
            )}
          >
            <Clock className="h-2.5 w-2.5" />
            {formatRelativeDate(task.dueAt)}
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
