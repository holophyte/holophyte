import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { PRIORITY_CONFIG, TaskPriority, TaskStatus } from '@convex/schema';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { CalendarPlus, ChevronDown, Maximize2, X } from 'lucide-react';
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  dateInputToTimestamp,
  formatDuration,
  timestampToDateInput,
} from '@/frontend/lib/dateUtils';
import { isEditableElement } from '@/frontend/lib/dom';
import { cn } from '@/frontend/lib/utils';
import { ClaudeButton } from './ClaudeButton';
import { LabelDots, LabelPicker } from './LabelPicker';
import { PromptHistory } from './PromptHistory';
import { PromptTemplatePicker } from './PromptTemplatePicker';
import { SubtaskList } from './SubtaskList';
import Button, { buttonVariants } from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import PageHeader from './ui/PageHeader';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import Separator from './ui/Separator';
import Skeleton from './ui/Skeleton';
import Textarea from './ui/Textarea';

export type TaskDetailTask = NonNullable<
  FunctionReturnType<typeof api.tasks.get>
>;

interface TaskDetailPanelProps {
  isOpen?: boolean;
  closeBtnRef?: RefObject<HTMLButtonElement | null>;
}

export default function TaskDetailPanel({
  isOpen = true,
  closeBtnRef,
}: TaskDetailPanelProps) {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const repoId = params.repoId as Id<'repos'> | undefined;
  const taskId = params.taskId as Id<'tasks'> | undefined;
  const task = useQuery(api.tasks.get, taskId ? { id: taskId } : 'skip');
  const panelRef = useRef<HTMLElement>(null);

  const closePanel = useCallback(() => {
    if (!repoId) return;
    void navigate({ to: '/repos/$repoId', params: { repoId } });
  }, [navigate, repoId]);

  // Close the panel when the task has been deleted (query returns null, not undefined)
  useEffect(() => {
    if (task === null && repoId) {
      closePanel();
    }
  }, [closePanel, task, repoId]);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        isEditableElement(activeElement) &&
        (panelRef.current?.contains(activeElement) ||
          !!activeElement.closest(
            '[data-radix-popper-content-wrapper], [data-radix-portal]',
          ))
      ) {
        return;
      }

      closePanel();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closePanel, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const onMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !panelRef.current) return;
      if (panelRef.current.contains(target)) return;
      // Radix UI portals render outside the panel DOM — skip clicks inside them
      if (
        target.closest(
          '[data-radix-popper-content-wrapper], [data-radix-portal]',
        )
      )
        return;

      // Let task-card clicks drive route changes without first collapsing the panel.
      if (target.closest('[data-task-id]')) return;

      closePanel();
    };

    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [closePanel, isOpen]);

  // Keep previous task visible while the next one loads (but not when deleted)
  const prevTaskRef = useRef<TaskDetailTask | null>(null);
  if (task) prevTaskRef.current = task;
  const displayTask = task === null ? null : (task ?? prevTaskRef.current);

  return (
    <section
      ref={panelRef}
      aria-labelledby="task-detail-heading"
      className={cn(
        'absolute right-0 top-0 bottom-0 z-10 w-96 border-l bg-background flex flex-col overflow-hidden shadow-xl',
        'transition-transform duration-300 ease-in-out motion-reduce:transition-none',
        isOpen ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      <PageHeader className="justify-between">
        <h2 id="task-detail-heading" className="font-semibold text-sm">
          Task Details
        </h2>
        <div className="flex items-center gap-1">
          {taskId && repoId && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                void navigate({
                  to: '/repos/$repoId/tasks/$taskId/page',
                  params: { repoId, taskId },
                })
              }
              aria-label="Expand to full page"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <button
            ref={closeBtnRef}
            type="button"
            onClick={closePanel}
            aria-label="Close panel"
            className={buttonVariants({ variant: 'ghost', size: 'icon' })}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </PageHeader>
      {displayTask ? (
        <TaskDetailContent task={displayTask} />
      ) : (
        <TaskDetailSkeleton />
      )}
    </section>
  );
}

function TaskDetailSkeleton() {
  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <Skeleton className="h-9 w-full" />
      <div className="space-y-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-4 w-32" />
      </div>
      <Skeleton className="h-4 w-24" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-9 w-full" />
      </div>
      <Separator />
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-20 w-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

interface TaskDetailContentProps {
  task: TaskDetailTask;
  showDelete?: boolean;
  showSessionControls?: boolean;
}

export function TaskDetailContent({
  task,
  showDelete = true,
  showSessionControls = true,
}: TaskDetailContentProps) {
  const navigate = useNavigate();
  const updateTask = useMutation(api.tasks.update);
  const removeTask = useMutation(api.tasks.remove);

  const [prevTaskId, setPrevTaskId] = useState(task._id);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [prompt, setPrompt] = useState(task.prompt);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(Boolean(task.dueAt));

  // Reset local state when switching tasks (synchronous, no useEffect)
  if (task._id !== prevTaskId) {
    setPrevTaskId(task._id);
    setTitle(task.title);
    setDescription(task.description);
    setPrompt(task.prompt);
    setPriorityOpen(false);
    setShowDatePicker(Boolean(task.dueAt));
  }

  // Auto-save title on blur
  const handleTitleBlur = () => {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task.title) {
      updateTask({ id: task._id, title: trimmed });
    }
  };

  // Auto-save labels directly — no local state needed
  const handleLabelChange = (newLabelIds: Id<'labels'>[]) => {
    updateTask({ id: task._id, labelIds: newLabelIds });
  };

  // Auto-save priority directly
  const handlePriorityChange = (p: TaskPriority) => {
    setPriorityOpen(false);
    updateTask({ id: task._id, priority: p });
  };

  // Auto-save due date directly
  const handleDueDateChange = (value: string) => {
    if (value) {
      updateTask({ id: task._id, dueAt: dateInputToTimestamp(value) });
    } else if (task.dueAt) {
      updateTask({ id: task._id, clearDueAt: true });
    }
  };

  const handleSaveDescription = async () => {
    await updateTask({ id: task._id, description: description.trim() });
  };

  const handleSavePrompt = async () => {
    await updateTask({ id: task._id, prompt: prompt.trim() });
  };

  const handleDelete = async () => {
    await removeTask({ id: task._id });
    void navigate({
      to: '/repos/$repoId',
      params: { repoId: String(task.repoId) },
    });
  };

  const descriptionChanged = description !== task.description;
  const promptChanged = prompt !== task.prompt;

  // Derived from task — no local state needed
  const labelIds = task.labelIds ?? [];
  const dueDate = task.dueAt ? timestampToDateInput(task.dueAt) : '';
  const priority = (task.priority as TaskPriority) ?? TaskPriority.None;

  // Time tracking display
  const currentInProgressMs =
    task.status === TaskStatus.InProgress && task.inProgressSince
      ? Date.now() - task.inProgressSince
      : 0;
  const totalTimeMs = (task.totalInProgressMs ?? 0) + currentInProgressMs;

  const currentPriorityConfig =
    PRIORITY_CONFIG[priority] ?? PRIORITY_CONFIG[TaskPriority.None];

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Title at top */}
        <Label htmlFor="detail-title">Title</Label>
        <Input
          id="detail-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="text-base font-semibold h-auto py-1.5"
          placeholder="Task title"
        />

        {task.repo && (
          <div>
            <span className="text-xs text-muted-foreground">Repository</span>
            <p className="text-sm mt-1">{task.repo.name}</p>
            <p className="text-xs text-muted-foreground font-mono">
              {task.repo.path}
            </p>
          </div>
        )}

        {/* Tags */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground shrink-0">Tags</span>
          {task.labels && task.labels.length > 0 && (
            <LabelDots labels={task.labels} max={3} />
          )}
          <div className="ml-auto shrink-0">
            <LabelPicker
              currentLabelIds={labelIds}
              onChangeLabelIds={handleLabelChange}
              triggerAriaLabel="Tags"
            />
          </div>
        </div>

        {/* Priority dropdown */}
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">Priority</span>
          <Popover open={priorityOpen} onOpenChange={setPriorityOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Priority: ${currentPriorityConfig.label}`}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-sm hover:bg-muted/50 transition-colors w-full"
              >
                {currentPriorityConfig.color && (
                  <span
                    aria-hidden="true"
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: currentPriorityConfig.color }}
                  />
                )}
                <span className="flex-1 text-left">
                  {currentPriorityConfig.label}
                </span>
                <ChevronDown
                  aria-hidden={true}
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-44 p-1" align="start">
              {Object.values(TaskPriority).map((p) => {
                const config = PRIORITY_CONFIG[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePriorityChange(p)}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                      priority === p && 'bg-muted',
                    )}
                  >
                    {config.color ? (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: config.color }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0"
                      />
                    )}
                    {config.label}
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>
        </div>

        {/* Time tracking + due date row */}
        <div className="flex items-center gap-4">
          {totalTimeMs > 0 && (
            <div>
              <span className="text-xs text-muted-foreground">
                Time in Progress
              </span>
              <p className="text-sm mt-0.5 font-mono">
                {formatDuration(totalTimeMs)}
              </p>
            </div>
          )}
          <div className="flex-1">
            <Label
              htmlFor="detail-due-date"
              className="text-xs text-muted-foreground"
            >
              Due Date
            </Label>
            <div className="flex items-center gap-1 mt-0.5">
              {showDatePicker || dueDate ? (
                <>
                  <Input
                    id="detail-due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => handleDueDateChange(e.target.value)}
                    className="h-7 text-xs"
                  />
                  {dueDate ? (
                    <button
                      type="button"
                      onClick={() => {
                        handleDueDateChange('');
                        setShowDatePicker(false);
                      }}
                      aria-label="Clear due date"
                      className="p-1 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDatePicker(false)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Cancel
                    </Button>
                  )}
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowDatePicker(true)}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  No deadline
                </Button>
              )}
            </div>
          </div>
        </div>

        <Separator />
        <div className="space-y-2">
          <Label htmlFor="detail-description">Description</Label>
          <Textarea
            id="detail-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
          {descriptionChanged && (
            <div className="flex gap-1">
              <Button size="sm" onClick={handleSaveDescription}>
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDescription(task.description)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="detail-prompt">Claude Prompt</Label>
            <div className="flex gap-1">
              <PromptTemplatePicker repoId={task.repoId} onApply={setPrompt} />
              <PromptHistory
                taskId={task._id}
                historyCount={task.promptHistoryCount ?? 0}
                currentPrompt={prompt}
                onRestore={setPrompt}
              />
            </div>
          </div>
          <Textarea
            id="detail-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            className="font-mono text-xs"
          />
          {promptChanged && (
            <div className="flex gap-1">
              <Button size="sm" onClick={handleSavePrompt}>
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPrompt(task.prompt)}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
        <Separator />

        {/* Subtasks */}
        <section aria-labelledby="detail-subtasks-label" className="space-y-2">
          <span
            id="detail-subtasks-label"
            className="text-xs text-muted-foreground"
          >
            Subtasks
          </span>
          <SubtaskList taskId={task._id} />
        </section>

        {showSessionControls && (
          <>
            <Separator />
            <section
              aria-labelledby="detail-session-label"
              className="space-y-2"
            >
              <span
                id="detail-session-label"
                className="text-xs text-muted-foreground"
              >
                Claude Code Session
              </span>
              <ClaudeButton task={task} />
            </section>
          </>
        )}
      </div>
      {showDelete && (
        <div className="border-t p-4 flex items-center gap-2">
          <Button size="sm" variant="destructive" onClick={handleDelete}>
            Delete
          </Button>
        </div>
      )}
    </>
  );
}
