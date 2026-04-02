import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useMutation } from 'convex/react';
import { Archive, ChevronsLeft, Plus } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import type { EnrichedTask } from './KanbanBoard';
import { TaskCard } from './TaskCard';

interface KanbanColumnProps {
  status: TaskStatus;
  label: string;
  tasks: EnrichedTask[];
  repoMap: Map<Id<'repos'>, Doc<'repos'>>;
  showRepoBadge: boolean;
  variant?: 'default' | 'backlog';
  sortActive?: boolean;
  onCollapse?: () => void;
  onArchiveAll?: () => void;
  onAddTask?: () => void;
  addTaskDisabled?: boolean;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  repoMap,
  showRepoBadge,
  variant = 'default',
  sortActive = false,
  onCollapse,
  onArchiveAll,
  onAddTask,
  addTaskDisabled = false,
}: KanbanColumnProps) {
  const moveTask = useMutation(api.tasks.move);
  const reorderTask = useMutation(api.tasks.reorder);
  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingFromThisColumn = useRef(false);

  const bulkSelectedTaskIds = useAppStore((s) => s.bulkSelectedTaskIds);
  const bulkSelectAll = useAppStore((s) => s.bulkSelectAll);
  const bulkDeselectAll = useAppStore((s) => s.bulkDeselectAll);

  const isBulkMode = bulkSelectedTaskIds.length > 0;
  const columnTaskIds = useMemo(() => tasks.map((t) => t._id), [tasks]);
  const selectedInColumn = useMemo(
    () => columnTaskIds.filter((id) => bulkSelectedTaskIds.includes(id)),
    [columnTaskIds, bulkSelectedTaskIds],
  );
  const allSelected =
    tasks.length > 0 && selectedInColumn.length === tasks.length;
  const someSelected =
    selectedInColumn.length > 0 && selectedInColumn.length < tasks.length;

  const handleSelectAll = () => {
    if (allSelected) {
      bulkDeselectAll(columnTaskIds);
    } else {
      bulkSelectAll(columnTaskIds);
    }
  };

  const getDropIndex = useCallback(
    (clientY: number): number => {
      if (!containerRef.current) return tasks.length;
      const cards = containerRef.current.querySelectorAll('[data-task-id]');
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        if (!card) continue;
        const rect = card.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (clientY < midY) return i;
      }
      return tasks.length;
    },
    [tasks.length],
  );

  const computePosition = (insertIndex: number): number => {
    const prev = insertIndex > 0 ? tasks[insertIndex - 1] : undefined;
    const next = insertIndex < tasks.length ? tasks[insertIndex] : undefined;
    const prevPos = prev?.position ?? 0;
    const nextPos = next?.position ?? prevPos + 2;
    return (prevPos + nextPos) / 2;
  };

  const handleDragStart = () => {
    draggingFromThisColumn.current = true;
  };

  const handleDragEnd = () => {
    draggingFromThisColumn.current = false;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const sameColumnReorder = draggingFromThisColumn.current && sortActive;
    e.dataTransfer.dropEffect = sameColumnReorder ? 'none' : 'move';
    if (!sameColumnReorder) {
      setDragOver(true);
      setDropIndex(getDropIndex(e.clientY));
    } else {
      setDragOver(false);
      setDropIndex(null);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only handle leave if actually leaving the column (not entering a child)
    if (
      e.relatedTarget instanceof Node &&
      (e.currentTarget as Node).contains(e.relatedTarget)
    ) {
      return;
    }
    setDragOver(false);
    setDropIndex(null);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    setDropIndex(null);

    const taskId = e.dataTransfer.getData('text/plain') as Id<'tasks'>;
    const sourceStatus = e.dataTransfer.getData('application/x-status');
    if (!taskId) return;

    const insertAt = getDropIndex(e.clientY);
    const newPosition = computePosition(insertAt);

    if (sourceStatus === status) {
      // Same column: skip reorder when a non-manual sort is active
      if (sortActive) return;
      await reorderTask({ id: taskId, position: newPosition });
    } else {
      // Different column: move with status change.
      // When sortActive, visual order doesn't reflect position order, so
      // midpoint insertion could collide. Append to end instead.
      const position = sortActive
        ? Math.max(0, ...tasks.map((t) => t.position)) + 1
        : newPosition;
      await moveTask({ id: taskId, status, position });
    }
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: div with role needed for drag-and-drop
    <div
      role="group"
      aria-label={`${label} column`}
      className={cn(
        'group flex flex-col rounded-lg border',
        variant === 'backlog'
          ? 'bg-muted/30 border-dashed w-full h-full'
          : 'flex-1 min-w-[260px] max-w-[350px] bg-muted/50',
        dragOver && 'ring-2 ring-primary/50 bg-muted/80',
      )}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isBulkMode && tasks.length > 0 && (
            <button
              type="button"
              onClick={handleSelectAll}
              className={cn(
                'h-4 w-4 rounded border flex items-center justify-center transition-all shrink-0',
                allSelected
                  ? 'bg-primary border-primary text-primary-foreground'
                  : someSelected
                    ? 'bg-primary/50 border-primary text-primary-foreground'
                    : 'border-muted-foreground/30 bg-background',
              )}
              aria-label={
                allSelected
                  ? `Deselect all in ${label}`
                  : `Select all in ${label}`
              }
            >
              {(allSelected || someSelected) && (
                <svg
                  aria-hidden="true"
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  {allSelected ? (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  ) : (
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 12h14"
                    />
                  )}
                </svg>
              )}
            </button>
          )}
          <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
            {tasks.length}
          </span>
          {status === TaskStatus.Done && tasks.length > 0 && onArchiveAll && (
            <button
              type="button"
              onClick={onArchiveAll}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              aria-label="Archive all done tasks"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label={`Collapse ${label} column`}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            >
              <ChevronsLeft className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
      {onAddTask && (
        <div className="px-2 pb-2">
          <button
            type="button"
            onClick={onAddTask}
            disabled={addTaskDisabled}
            className="w-full flex items-center justify-center gap-1 py-1.5 rounded-md text-xs text-muted-foreground bg-muted/60 hover:bg-muted hover:text-foreground transition-colors border border-dashed border-muted-foreground/30 disabled:cursor-not-allowed disabled:border-muted-foreground/15 disabled:bg-muted/30 disabled:text-muted-foreground/50 disabled:opacity-100 disabled:hover:bg-muted/30 disabled:hover:text-muted-foreground/50"
            aria-label={
              addTaskDisabled
                ? `Add task disabled for ${label}`
                : `Add task to ${label}`
            }
            title={
              addTaskDisabled
                ? 'Add a repository before creating tasks'
                : undefined
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
      )}
      <div ref={containerRef} className="overflow-y-auto px-2 pb-2 space-y-2">
        {tasks.map((task, i) => (
          <div key={task._id}>
            {dragOver && dropIndex === i && (
              <div className="h-0.5 bg-primary rounded-full mx-1 mb-2" />
            )}
            <TaskCard
              task={task}
              repoName={
                showRepoBadge ? repoMap.get(task.repoId)?.name : undefined
              }
            />
          </div>
        ))}
        {dragOver && dropIndex === tasks.length && (
          <div className="h-0.5 bg-primary rounded-full mx-1" />
        )}
      </div>
    </div>
  );
}
