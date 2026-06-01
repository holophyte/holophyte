import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import {
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock3,
  Minimize2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatElapsedSeconds } from '@/frontend/lib/dateUtils';
import { isEditableElement } from '@/frontend/lib/dom';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import SessionPanel from './SessionPanel';
import { TaskDetailContent } from './TaskDetailPanel';
import Badge from './ui/Badge';
import PageHeader from './ui/PageHeader';
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

export default function TaskPageView() {
  const params = useParams({ strict: false });
  const navigate = useNavigate();
  const repoId = params.repoId as Id<'repos'> | undefined;
  const selectedTaskId = (params.taskId as Id<'tasks'> | undefined) ?? null;
  const openSession = useAppStore((s) => s.openSession);
  const closeSession = useAppStore((s) => s.closeSession);
  const taskPageDetailCollapsed = useAppStore((s) => s.taskPageDetailCollapsed);
  const toggleTaskPageDetail = useAppStore((s) => s.toggleTaskPageDetail);
  const moveTaskBulk = useMutation(api.tasks.bulkMove);

  const task = useQuery(
    api.tasks.get,
    selectedTaskId ? { id: selectedTaskId } : 'skip',
  );
  const latestSession = useQuery(
    api.sessions.getByTask,
    selectedTaskId ? { taskId: selectedTaskId } : 'skip',
  );

  // Keep previous task visible while the next one loads (same pattern as TaskDetailPanel)
  const prevTaskRef = useRef<NonNullable<typeof task> | null>(null);
  if (task) prevTaskRef.current = task;
  const displayTask = task === null ? null : (task ?? prevTaskRef.current);

  const autoOpenedTaskRef = useRef<Id<'tasks'> | null>(null);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (task === null && repoId) {
      void navigate({ to: '/repos/$repoId', params: { repoId } });
    }
  }, [task, navigate, repoId]);

  // Open latest task session once per task so the page has immediate context.
  // The ref tracks which task we last auto-opened for, so we don't re-trigger
  // when the same latestSession query re-fires.
  useEffect(() => {
    if (!selectedTaskId || latestSession === undefined) return;
    if (autoOpenedTaskRef.current === selectedTaskId) return;
    autoOpenedTaskRef.current = selectedTaskId;
    if (latestSession) {
      openSession(latestSession._id);
    } else {
      // No session for this task — clear any stale session from a previous task.
      closeSession();
    }
  }, [selectedTaskId, latestSession, openSession, closeSession]);

  useEffect(() => {
    if (latestSession?.status !== 'running') return;
    setNow(Date.now());
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [latestSession?.status]);

  const runningElapsed = useMemo(() => {
    if (latestSession?.status !== 'running') return null;
    const seconds = Math.max(
      0,
      Math.floor((now - latestSession.startedAt) / 1000),
    );
    return formatElapsedSeconds(seconds);
  }, [latestSession, now]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      const isEditable = isEditableElement(document.activeElement);

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
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [toggleTaskPageDetail]);

  if (!selectedTaskId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a task to begin.
      </div>
    );
  }

  if (!displayTask) {
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

  const statusMeta = TASK_STATUS_OPTIONS.find(
    (option) => option.status === displayTask.status,
  ) ?? {
    status: displayTask.status,
    label: 'Unknown',
    dotClass: 'bg-slate-500',
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PageHeader className="gap-3 px-4">
        <nav
          aria-label="breadcrumb"
          className="min-w-0 flex items-center gap-1.5 text-sm"
        >
          <button
            type="button"
            className="truncate text-lg font-semibold cursor-pointer hover:text-muted-foreground transition-colors"
            onClick={() =>
              void navigate({
                to: '/repos/$repoId',
                params: { repoId: String(displayTask.repoId) },
              })
            }
          >
            {displayTask.repo?.name ?? 'Project'}
          </button>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          <span
            aria-current="page"
            className="truncate font-medium text-foreground"
          >
            {displayTask.title}
          </span>
        </nav>

        <Popover open={statusPickerOpen} onOpenChange={setStatusPickerOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-border bg-muted px-3 text-xs font-semibold text-foreground"
              aria-label="Change task status"
            >
              <span
                aria-hidden="true"
                className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`}
              />
              {statusMeta.label}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-40 p-1" align="start" role="listbox">
            {TASK_STATUS_OPTIONS.map((option) => (
              <button
                key={option.status}
                type="button"
                role="option"
                aria-selected={option.status === displayTask.status}
                className={cn(
                  'flex min-h-11 w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs font-medium hover:bg-muted',
                  option.status === displayTask.status && 'bg-muted',
                )}
                onClick={() => {
                  setStatusPickerOpen(false);
                  if (option.status === displayTask.status) return;
                  void moveTaskBulk({
                    ids: [displayTask._id],
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

        {runningElapsed && (
          <Badge
            variant="outline"
            className="inline-flex min-h-11 items-center gap-1.5 px-3 text-xs"
          >
            <Clock3 aria-hidden="true" className="h-3.5 w-3.5" />
            {runningElapsed}
          </Badge>
        )}

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            aria-label="Collapse to side panel"
            onClick={() =>
              repoId &&
              selectedTaskId &&
              void navigate({
                to: '/repos/$repoId/tasks/$taskId',
                params: { repoId, taskId: selectedTaskId },
              })
            }
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close task"
            onClick={() =>
              repoId &&
              void navigate({ to: '/repos/$repoId', params: { repoId } })
            }
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </PageHeader>

      <div className="flex min-h-0 flex-1">
        <section
          className={cn(
            'relative shrink-0 border-r transition-[width,min-width,max-width,flex] duration-300 ease-in-out overflow-hidden',
            taskPageDetailCollapsed
              ? 'w-10 min-w-[40px] max-w-[40px] flex-none'
              : 'w-[28rem] min-w-[28rem] max-w-[28rem]',
          )}
        >
          {/* Collapsed pill — matches backlog style */}
          <button
            type="button"
            onClick={toggleTaskPageDetail}
            aria-label="Expand task details"
            aria-expanded={false}
            aria-hidden={!taskPageDetailCollapsed}
            tabIndex={taskPageDetailCollapsed ? 0 : -1}
            className={cn(
              'absolute inset-0 w-10 bg-muted/30',
              'flex flex-col items-center justify-center gap-2',
              'hover:bg-muted/80 cursor-pointer',
              'transition-opacity duration-300',
              taskPageDetailCollapsed
                ? 'opacity-100 delay-100'
                : 'opacity-0 pointer-events-none',
            )}
          >
            <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-lr] rotate-180">
              Task Details
            </span>
            <ChevronsRight className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {/* Expanded content */}
          <div
            className={cn(
              'h-full flex flex-col overflow-hidden bg-muted/30 transition-opacity',
              taskPageDetailCollapsed
                ? 'opacity-0 pointer-events-none duration-100'
                : 'opacity-100 delay-100 duration-300',
            )}
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Task Details</h2>
              <button
                type="button"
                aria-label="Collapse task details"
                aria-expanded={true}
                onClick={toggleTaskPageDetail}
                className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground"
              >
                <ChevronsLeft className="h-4 w-4" />
              </button>
            </div>
            <TaskDetailContent
              task={displayTask}
              showDelete
              showSessionControls={false}
            />
          </div>
        </section>
        <section className="min-w-0 flex-1">
          <SessionPanel taskId={selectedTaskId} />
        </section>
      </div>
    </div>
  );
}
