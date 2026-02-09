import { useMutation, useQuery } from "convex/react";
import { Play, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@convex/_generated/api";
import { useAppStore } from "@/frontend/stores/app";
import { ClaudeButton } from "./ClaudeButton";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Separator } from "./ui/separator";
import { Textarea } from "./ui/textarea";

export function TaskDetailPanel() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectTask = useAppStore((s) => s.selectTask);
  const task = useQuery(
    api.tasks.get,
    selectedTaskId ? { id: selectedTaskId } : "skip",
  );
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
      setPrompt(task.prompt);
    }
  }, [task]);

  if (!task) return null;

  const handleSave = async () => {
    await updateTask({
      id: task._id,
      title: title.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
    });
  };

  const handleDelete = async () => {
    await removeTask({ id: task._id });
    selectTask(null);
  };

  const hasChanges =
    title !== task.title ||
    description !== task.description ||
    prompt !== task.prompt;

  return (
    <div className="w-96 border-l bg-background flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="font-semibold text-sm">Task Details</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => selectTask(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {task.repo && (
          <div>
            <Label className="text-xs text-muted-foreground">Repository</Label>
            <p className="text-sm mt-1">{task.repo.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {task.repo.path}
            </p>
          </div>
        )}
        <Separator />
        <div className="space-y-2">
          <Label htmlFor="detail-title">Title</Label>
          <Input
            id="detail-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="detail-description">Description</Label>
          <Textarea
            id="detail-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="detail-prompt">Claude Prompt</Label>
          <Textarea
            id="detail-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
        </div>
        <Separator />
        <div className="space-y-2">
          <Label>Claude Code Session</Label>
          <ClaudeButton task={task} />
        </div>
      </div>
      <div className="border-t p-4 flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!hasChanges}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={handleDelete}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
