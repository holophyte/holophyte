import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { PanelLeftClose } from "lucide-react";
import { useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { TaskCard } from "./TaskCard";

type TaskStatus = "backlog" | "todo" | "in_progress" | "review" | "done";

interface KanbanColumnProps {
  status: TaskStatus;
  label: string;
  tasks: Doc<"tasks">[];
  repoMap: Map<Id<"repos">, Doc<"repos">>;
  showRepoBadge: boolean;
  collapsible?: boolean;
  onCollapse?: () => void;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  repoMap,
  showRepoBadge,
  collapsible,
  onCollapse,
}: KanbanColumnProps) {
  const moveTask = useMutation(api.tasks.move);
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    const taskId = e.dataTransfer.getData("text/plain") as Id<"tasks">;
    if (!taskId) return;

    // Calculate position: place at end
    const maxPosition = tasks.reduce((max, t) => Math.max(max, t.position), 0);
    const newPosition = maxPosition + 1;

    await moveTask({ id: taskId, status, position: newPosition });
  };

  return (
    <div
      role="group"
      aria-label={`${label} column`}
      className={cn(
        "flex-1 min-w-[260px] max-w-[350px] flex flex-col rounded-lg bg-muted/50 border",
        dragOver && "ring-2 ring-primary/50 bg-muted/80",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {tasks.length}
          </span>
          {collapsible && onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <PanelLeftClose className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {tasks.map((task) => (
          <TaskCard
            key={task._id}
            task={task}
            repoName={
              showRepoBadge ? repoMap.get(task.repoId)?.name : undefined
            }
          />
        ))}
      </div>
    </div>
  );
}
