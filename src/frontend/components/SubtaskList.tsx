import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";

interface SubtaskListProps {
  taskId: Id<"tasks">;
}

export function SubtaskList({ taskId }: SubtaskListProps) {
  const subtasks = useQuery(api.subtasks.listByTask, { taskId });
  const createSubtask = useMutation(api.subtasks.create);
  const toggleSubtask = useMutation(api.subtasks.toggle);
  const updateTitle = useMutation(api.subtasks.updateTitle);
  const removeSubtask = useMutation(api.subtasks.remove);
  const [newTitle, setNewTitle] = useState("");
  const [editingId, setEditingId] = useState<Id<"subtasks"> | null>(null);
  const [editingTitle, setEditingTitle] = useState("");

  if (!subtasks) return null;

  const completedCount = subtasks.filter((s) => s.completed).length;
  const totalCount = subtasks.length;
  const progressPercent =
    totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  const handleAdd = async () => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    await createSubtask({ taskId, title: trimmed });
    setNewTitle("");
  };

  const handleEditSave = async (id: Id<"subtasks">) => {
    const trimmed = editingTitle.trim();
    if (trimmed) {
      await updateTitle({ id, title: trimmed });
    }
    setEditingId(null);
    setEditingTitle("");
  };

  return (
    <div className="space-y-2">
      {totalCount > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground shrink-0">
            {completedCount}/{totalCount}
          </span>
        </div>
      )}
      <div className="space-y-1">
        {subtasks.map((subtask) => (
          <div
            key={subtask._id}
            className="flex items-center gap-2 group rounded px-1 py-0.5 hover:bg-muted/50"
          >
            <Checkbox
              checked={subtask.completed}
              onCheckedChange={() => toggleSubtask({ id: subtask._id })}
            />
            {editingId === subtask._id ? (
              <Input
                value={editingTitle}
                onChange={(e) => setEditingTitle(e.target.value)}
                onBlur={() => handleEditSave(subtask._id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleEditSave(subtask._id);
                  if (e.key === "Escape") {
                    setEditingId(null);
                    setEditingTitle("");
                  }
                }}
                className="h-6 text-xs flex-1 px-1"
                autoFocus
              />
            ) : (
              <button
                type="button"
                className={cn(
                  "text-xs flex-1 cursor-pointer text-left bg-transparent border-none p-0",
                  subtask.completed && "line-through text-muted-foreground",
                )}
                onClick={() => {
                  setEditingId(subtask._id);
                  setEditingTitle(subtask.title);
                }}
              >
                {subtask.title}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeSubtask({ id: subtask._id })}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-opacity"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Plus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          placeholder="Add subtask..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
          }}
          className="h-7 text-xs flex-1 px-2"
        />
      </div>
    </div>
  );
}
