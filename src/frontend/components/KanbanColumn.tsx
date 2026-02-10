import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import type { TaskStatus } from '@convex/schema';
import { useMutation } from 'convex/react';
import { Archive, PanelLeftClose } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import type { EnrichedTask } from './KanbanBoard';
import { TaskCard } from './TaskCard';

interface KanbanColumnProps {
  status: TaskStatus;
  label: string;
  tasks: EnrichedTask[];
  repoMap: Map<Id<'repos'>, Doc<'repos'>>;
  showRepoBadge: boolean;
  collapsible?: boolean;
  onCollapse?: () => void;
  onArchiveAll?: () => void;
}

export function KanbanColumn({
  status,
  label,
  tasks,
  repoMap,
  showRepoBadge,
  collapsible,
  onCollapse,
  onArchiveAll,
}: KanbanColumnProps) {
  const moveTask = useMutation(api.tasks.move);
  const reorderTask = useMutation(api.tasks.reorder);
  const [dragOver, setDragOver] = useState(false);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(true);
    setDropIndex(getDropIndex(e.clientY));
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
      // Same column: just reorder
      await reorderTask({ id: taskId, position: newPosition });
    } else {
      // Different column: move with status change
      await moveTask({ id: taskId, status, position: newPosition });
    }
  };

  return (
    <div
      role="group"
      aria-label={`${label} column`}
      className={cn(
        'flex-1 min-w-[260px] max-w-[350px] flex flex-col rounded-lg bg-muted/50 border',
        dragOver && 'ring-2 ring-primary/50 bg-muted/80',
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
          {status === 'done' && tasks.length > 0 && onArchiveAll && (
            <button
              type="button"
              onClick={onArchiveAll}
              className="p-0.5 rounded text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              title="Archive all done tasks"
            >
              <Archive className="h-3.5 w-3.5" />
            </button>
          )}
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
      <div ref={containerRef} className="flex-1 overflow-y-auto p-2 space-y-2">
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
