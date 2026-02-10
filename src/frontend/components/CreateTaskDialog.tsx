import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { TaskStatus } from '@convex/schema';
import { PRIORITY_CONFIG, TaskPriority } from '@convex/schema';
import { useMutation } from 'convex/react';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import Button from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import Input from './ui/Input';
import Label from './ui/Label';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import Textarea from './ui/Textarea';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repoId: Id<'repos'>;
  initialStatus?: TaskStatus;
}

export function CreateTaskDialog({
  open,
  onOpenChange,
  repoId,
  initialStatus,
}: CreateTaskDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.None);
  const createTask = useMutation(api.tasks.create);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    await createTask({
      repoId,
      title: title.trim(),
      description: description.trim() || undefined,
      prompt: prompt.trim() || undefined,
      status: initialStatus,
      priority: priority !== TaskPriority.None ? priority : undefined,
    });

    setTitle('');
    setDescription('');
    setPrompt('');
    setPriority(TaskPriority.None);
    onOpenChange(false);
  };

  const statusLabel = initialStatus
    ? initialStatus.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : 'Backlog';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Task</DialogTitle>
            <DialogDescription>
              Add a new task to {statusLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                placeholder="Task title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-description">Description</Label>
              <Textarea
                id="task-description"
                placeholder="Optional description..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="task-prompt">Claude Prompt</Label>
              <Textarea
                id="task-prompt"
                placeholder="Prompt to send to Claude Code..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Priority</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-sm hover:bg-muted/50 transition-colors w-full"
                  >
                    {PRIORITY_CONFIG[priority].color && (
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: PRIORITY_CONFIG[priority].color,
                        }}
                      />
                    )}
                    <span className="flex-1 text-left">
                      {PRIORITY_CONFIG[priority].label}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-1" align="start">
                  {Object.values(TaskPriority).map((p) => {
                    const config = PRIORITY_CONFIG[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriority(p)}
                        className={cn(
                          'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                          priority === p && 'bg-muted',
                        )}
                      >
                        {config.color ? (
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: config.color }}
                          />
                        ) : (
                          <span className="h-2.5 w-2.5 shrink-0" />
                        )}
                        {config.label}
                      </button>
                    );
                  })}
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
