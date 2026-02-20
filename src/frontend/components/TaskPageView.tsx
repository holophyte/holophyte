import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useMutation, useQuery } from 'convex/react';
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '@/frontend/stores/app';
import { ClaudeButton } from './ClaudeButton';
import SessionPanel from './SessionPanel';
import { TaskDetailContent } from './TaskDetailPanel';
import Badge from './ui/Badge';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';
import Skeleton from './ui/Skeleton';

const TASK_STATUS_OPTIONS = [
  {
    status: TaskStatus.Backlog,
    label: 'Backlog',
    dotClass: 'bg-slate-500',
  },
  {
    status: TaskStatus.Todo,
    label: 'To Do',
    dotClass: 'bg-sky-500',
  },
  {
    status: TaskStatus.InProgress,
    label: 'In Progress',
    dotClass: 'bg-emerald-500',
  },
  {
    status: TaskStatus.Review,
    label: 'Review',
    dotClass: 'bg-amber-500',
  },
  {
    status: TaskStatus.Done,
    label: 'Done',
    dotClass: 'bg-zinc-500',
  },
  {
    status: TaskStatus.Archived,
    label: 'Archived',
    dotClass: 'bg-zinc-500',
  },
] as const;

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}

function formatElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours > 0) {
    return `${hours}h ${String(remMins).padStart(2, '0')}m`;
  }
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export function TaskPageView() {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const sessionId = useAppStore((s) => s.sessionId);
  const selectTask = useAppStore((s) => s.selectTask);
  const selectRepo = useAppStore((s) => s.selectRepo);
  const openSession = useAppStore((s) => s.openSession);
  const taskPageDetailCollapsed = useAppStore((s) => s.taskPageDetailCollapsed);
  const taskPageFocusMode = useAppStore((s) => s.taskPageFocusMode);
  const toggleTaskPageDetail = useAppStore((s) => s.toggleTaskPageDetail);
  const toggleTaskPageFocusMode = useAppStore((s) => s.toggleTaskPageFocusMode);
  const moveTaskBulk = useMutation(api.tasks.bulkMove);

  const task = useQuery(
    api.tasks.get,
    selectedTaskId ? { id: selectedTaskId } : 'skip',
  );
  const latestSession = useQuery(
    api.sessions.getByTask,
    selectedTaskId ? { taskId: selectedTaskId } : 'skip',
  );

  const autoOpenedTaskRef = useRef<Id<'tasks'> | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (task === null) {
      selectTask(null);
    }
  }, [task, selectTask]);

  // Open latest task session once per task so the page has immediate context.
  useEffect(() => {
    if (!selectedTaskId || latestSession === undefined) return;
    if (autoOpenedTaskRef.current === selectedTaskId) return;
    autoOpenedTaskRef.current = selectedTaskId;
    if (latestSession && sessionId !== latestSession._id) {
      openSession(latestSession._id);
    }
  }, [selectedTaskId, latestSession, sessionId, openSession]);

  useEffect(() => {
    if (latestSession?.status !== 'running') return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [latestSession?.status]);

  const runningElapsed = useMemo(() => {
    if (!latestSession || latestSession.status !== 'running') return null;
    const seconds = Math.max(
      0,
      Math.floor((now - latestSession.startedAt) / 1000),
    );
    return formatElapsed(seconds);
  }, [latestSession, now]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const activeElement = document.activeElement;
      const isEditable = isEditableElement(activeElement);
      const promptElements = document.querySelectorAll(
        '[data-permission-prompt][data-resolved="false"]',
      );
      const promptFocused =
        activeElement instanceof HTMLElement &&
        activeElement.closest('[data-permission-prompt]') !== null;
      const singlePromptHotkeyEligible =
        promptElements.length === 1 && !isEditable;

      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'f'
      ) {
        event.preventDefault();
        toggleTaskPageFocusMode();
        return;
      }

      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        event.key === '[' &&
        !isEditable
      ) {
        event.preventDefault();
        toggleTaskPageDetail();
        return;
      }

      if (event.key === 'Escape') {
        if (promptFocused || singlePromptHotkeyEligible || isEditable) return;
        event.preventDefault();
        if (task?.repoId) {
          selectRepo(task.repoId);
        }
        selectTask(null);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [
    selectRepo,
    selectTask,
    task?.repoId,
    toggleTaskPageDetail,
    toggleTaskPageFocusMode,
  ]);

  if (!selectedTaskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a task to begin.
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        <div className="border-b px-4 py-3">
          <Skeleton className="h-6 w-72" />
        </div>
        <div className="flex flex-1 min-h-0">
          <div className="w-[28rem] border-r p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
          <div className="flex-1 p-4 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        </div>
      </div>
    );
  }

  const statusMeta =
    TASK_STATUS_OPTIONS.find((option) => option.status === task.status) ??
    TASK_STATUS_OPTIONS[0];

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <header className="border-b px-4 py-2.5">
        <div className="flex items-center gap-3">
          <nav
            aria-label="breadcrumb"
            className="min-w-0 flex items-center gap-1.5 text-sm"
          >
            <Button
              variant="ghost"
              className="h-11 px-3 text-sm font-medium max-w-52 justify-start"
              onClick={() => selectRepo(task.repoId)}
            >
              <span className="truncate">{task.repo?.name ?? 'Project'}</span>
            </Button>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="truncate font-medium text-foreground">
              {task.title}
            </span>
          </nav>

          <Popover open={statusPickerOpen} onOpenChange={setStatusPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-muted px-3 text-xs font-semibold text-foreground"
                aria-label="Change task status"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}
                />
                {statusMeta.label}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="start">
              {TASK_STATUS_OPTIONS.map((option) => (
                <button
                  key={option.status}
                  type="button"
                  className={`flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium hover:bg-muted ${
                    option.status === task.status ? 'bg-muted' : ''
                  }`}
                  onClick={() => {
                    setStatusPickerOpen(false);
                    if (option.status === task.status) return;
                    void moveTaskBulk({
                      ids: [task._id],
                      status: option.status,
                    });
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${option.dotClass}`}
                  />
                  {option.label}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          {!taskPageFocusMode && runningElapsed && (
            <Badge
              variant="outline"
              className="inline-flex min-h-11 items-center gap-1.5 px-3 text-xs"
            >
              <Clock3 className="h-3.5 w-3.5" />
              {runningElapsed}
            </Badge>
          )}

          {!taskPageFocusMode && (
            <div className="ml-auto min-w-[14rem] max-w-[22rem]">
              <ClaudeButton task={task} />
            </div>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {!taskPageFocusMode && (
          <section
            className={`panel-collapse shrink-0 border-r bg-muted/15 ${
              taskPageDetailCollapsed ? 'w-20' : 'w-[28rem]'
            }`}
          >
            {taskPageDetailCollapsed ? (
              <div className="flex h-full flex-col">
                <button
                  type="button"
                  aria-label="Task details"
                  aria-expanded={false}
                  onClick={toggleTaskPageDetail}
                  className="flex min-h-11 items-center justify-center border-b hover:bg-muted/60"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
                <div className="flex-1 px-2 py-3">
                  <p className="line-clamp-5 text-xs font-medium leading-relaxed">
                    {task.title}
                  </p>
                  <Badge
                    variant="outline"
                    className="mt-3 inline-flex text-[10px] leading-none"
                  >
                    {statusMeta.label}
                  </Badge>
                </div>
              </div>
            ) : (
              <div className="flex h-full flex-col overflow-hidden bg-background">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <h2 className="text-sm font-semibold">Task Details</h2>
                  <button
                    type="button"
                    aria-label="Task details"
                    aria-expanded
                    onClick={toggleTaskPageDetail}
                    className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-muted"
                  >
                    <ChevronsLeft className="h-4 w-4" />
                  </button>
                </div>
                <TaskDetailContent
                  task={task}
                  showDelete
                  showSessionControls={false}
                />
              </div>
            )}
          </section>
        )}
        <section className="min-w-0 flex-1">
          <SessionPanel variant="task-page" />
        </section>
      </div>
    </div>
  );
}
