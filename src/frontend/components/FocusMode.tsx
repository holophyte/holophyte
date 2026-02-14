import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { PRIORITY_CONFIG, TaskPriority, TaskStatus } from '@convex/schema';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { Minimize2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import {
  dateInputToTimestamp,
  formatDuration,
  timestampToDateInput,
} from '@/frontend/lib/dateUtils';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import { BreakTimer } from './BreakTimer';
import { ClaudeButton } from './ClaudeButton';
import { SubtaskList } from './SubtaskList';
import { TerminalPanel } from './TerminalPanel';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Separator from './ui/Separator';
import Textarea from './ui/Textarea';

type Task = NonNullable<FunctionReturnType<typeof api.tasks.get>>;

export default function FocusMode() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const terminalSessionId = useAppStore((s) => s.terminalSessionId);
  const task = useQuery(
    api.tasks.get,
    selectedTaskId ? { id: selectedTaskId } : 'skip',
  );

  const prevTaskRef = useRef<Task | null>(null);
  if (task) prevTaskRef.current = task;
  const displayTask = task ?? prevTaskRef.current;

  if (!displayTask) {
    exitFocusMode();
    return null;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Focus mode header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold truncate max-w-md">
            {displayTask.title}
          </h2>
          {displayTask.priority &&
            displayTask.priority !== TaskPriority.None && (
              <PriorityDot priority={displayTask.priority as TaskPriority} />
            )}
        </div>
        <div className="flex items-center gap-4">
          <BreakTimer />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={exitFocusMode}
            aria-label="Exit focus mode"
          >
            <Minimize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Main content: task panel + terminal */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <FocusTaskPanel task={displayTask} />
        {terminalSessionId && <TerminalPanel />}
      </div>
    </div>
  );
}

function PriorityDot({ priority }: { priority: TaskPriority }) {
  const config = PRIORITY_CONFIG[priority];
  if (!config?.color) return null;
  return (
    <span
      className="h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: config.color }}
      title={config.label}
    />
  );
}

function FocusTaskPanel({ task }: { task: Task }) {
  const updateTask = useMutation(api.tasks.update);

  const [prevTaskId, setPrevTaskId] = useState(task._id);
  const [description, setDescription] = useState(task.description);
  const [prompt, setPrompt] = useState(task.prompt);

  if (task._id !== prevTaskId) {
    setPrevTaskId(task._id);
    setDescription(task.description);
    setPrompt(task.prompt);
  }

  const handleSaveDescription = async () => {
    await updateTask({ id: task._id, description: description.trim() });
  };

  const handleSavePrompt = async () => {
    await updateTask({ id: task._id, prompt: prompt.trim() });
  };

  const descriptionChanged = description !== task.description;
  const promptChanged = prompt !== task.prompt;

  // Time tracking
  const currentInProgressMs =
    task.status === TaskStatus.InProgress && task.inProgressSince
      ? Date.now() - task.inProgressSince
      : 0;
  const totalTimeMs = (task.totalInProgressMs ?? 0) + currentInProgressMs;
  const dueDate = task.dueAt ? timestampToDateInput(task.dueAt) : '';

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto space-y-5">
        {/* Context row: repo, time, due date */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          {task.repo && <span className="font-mono">{task.repo.name}</span>}
          {totalTimeMs > 0 && (
            <span className="font-mono">{formatDuration(totalTimeMs)}</span>
          )}
          {dueDate && <span>Due: {dueDate}</span>}
        </div>

        {/* Subtasks — the primary focus mode interaction */}
        <div className="space-y-2">
          <Label className="text-sm">Subtasks</Label>
          <SubtaskList taskId={task._id} />
        </div>

        <Separator />

        {/* Description — collapsed by default, expandable */}
        <CollapsibleSection label="Description" defaultOpen={false}>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
          {descriptionChanged && (
            <div className="flex gap-1 mt-1">
              <Button size="sm" onClick={handleSaveDescription}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDescription(task.description)}
              >
                Cancel
              </Button>
            </div>
          )}
        </CollapsibleSection>

        {/* Prompt */}
        <CollapsibleSection label="Claude Prompt" defaultOpen={false}>
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
          {promptChanged && (
            <div className="flex gap-1 mt-1">
              <Button size="sm" onClick={handleSavePrompt}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPrompt(task.prompt)}
              >
                Cancel
              </Button>
            </div>
          )}
        </CollapsibleSection>

        {/* Claude Code session */}
        <div className="space-y-2">
          <Label className="text-sm">Claude Code Session</Label>
          <ClaudeButton task={task} />
        </div>

        {/* Keyboard hint */}
        <p className="text-xs text-muted-foreground text-center pt-4">
          Press{' '}
          <kbd className="px-1.5 py-0.5 rounded border bg-muted text-[10px] font-mono">
            Esc
          </kbd>{' '}
          to exit focus mode
        </p>
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  label: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  label,
  defaultOpen,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground/80 transition-colors"
      >
        <span
          className={cn(
            'text-xs transition-transform',
            open ? 'rotate-90' : 'rotate-0',
          )}
        >
          ▶
        </span>
        {label}
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
}
