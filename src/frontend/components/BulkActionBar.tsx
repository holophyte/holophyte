import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useMutation, useQuery } from 'convex/react';
import { Archive, ArrowRight, Tag, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import type { EnrichedTask } from './KanbanBoard';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

const MOVE_TARGETS = [
  { status: TaskStatus.Backlog, label: 'Backlog' },
  { status: TaskStatus.Todo, label: 'To Do' },
  { status: TaskStatus.InProgress, label: 'In Progress' },
  { status: TaskStatus.Review, label: 'Review' },
  { status: TaskStatus.Done, label: 'Done' },
] as const;

interface BulkActionBarProps {
  allTasks: EnrichedTask[];
}

export default function BulkActionBar({ allTasks }: BulkActionBarProps) {
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const bulkSelectedTaskIds = useAppStore((s) => s.bulkSelectedTaskIds);
  const clearBulkSelection = useAppStore((s) => s.clearBulkSelection);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const bulkMove = useMutation(api.tasks.bulkMove);
  const bulkDelete = useMutation(api.tasks.bulkDelete);
  const bulkToggleLabel = useMutation(api.tasks.bulkToggleLabel);
  const labels = useQuery(
    api.labels.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );

  const count = bulkSelectedTaskIds.length;
  if (count === 0) return null;

  // Compute common labels across selected tasks
  const selectedTasks = allTasks.filter((t) =>
    bulkSelectedTaskIds.includes(t._id),
  );
  const commonLabelIds = getCommonLabelIds(selectedTasks);

  const handleMove = async (status: TaskStatus) => {
    await bulkMove({ ids: bulkSelectedTaskIds, status });
    clearBulkSelection();
  };

  const handleDelete = async () => {
    await bulkDelete({ ids: bulkSelectedTaskIds });
    clearBulkSelection();
    setConfirmDelete(false);
  };

  const handleToggleLabel = async (labelId: Id<'labels'>) => {
    const action = commonLabelIds.includes(labelId) ? 'remove' : 'add';
    await bulkToggleLabel({
      ids: bulkSelectedTaskIds,
      labelId,
      action,
    });
  };

  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${count} selected tasks`}
      className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-background border rounded-lg shadow-lg px-4 py-2"
    >
      <span className="text-sm font-medium mr-1">{count} selected</span>

      {/* Move to column */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <ArrowRight className="h-3.5 w-3.5" />
            Move
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-1" align="center" side="top">
          {MOVE_TARGETS.map((col) => (
            <button
              key={col.status}
              type="button"
              onClick={() => handleMove(col.status)}
              className="w-full text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors"
            >
              {col.label}
            </button>
          ))}
          <div className="border-t my-1" />
          <button
            type="button"
            onClick={() => handleMove(TaskStatus.Archived)}
            className="w-full flex items-center gap-2 text-left px-3 py-1.5 text-sm rounded hover:bg-muted transition-colors text-muted-foreground"
          >
            <Archive className="h-3.5 w-3.5" />
            Archive
          </button>
        </PopoverContent>
      </Popover>

      {/* Assign label */}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Tag className="h-3.5 w-3.5" />
            Label
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-52 p-2" align="center" side="top">
          <div className="space-y-1">
            {labels?.map((label) => {
              const isActive = commonLabelIds.includes(label._id);
              return (
                <button
                  key={label._id}
                  type="button"
                  onClick={() => handleToggleLabel(label._id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted transition-colors text-left',
                    isActive && 'bg-muted',
                  )}
                >
                  <span
                    className="h-3 w-3 rounded-sm shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate flex-1">{label.name}</span>
                  {isActive && (
                    <span className="text-xs text-primary">&#10003;</span>
                  )}
                </button>
              );
            })}
            {(!labels || labels.length === 0) && (
              <p className="text-xs text-muted-foreground px-2 py-1">
                No labels created yet
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Delete */}
      {confirmDelete ? (
        <div className="flex items-center gap-1">
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            Confirm
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </Button>
      )}

      {/* Clear selection */}
      <button
        type="button"
        onClick={clearBulkSelection}
        className="ml-1 p-1 rounded hover:bg-muted text-muted-foreground transition-colors"
        aria-label="Clear selection"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function getCommonLabelIds(tasks: EnrichedTask[]): Id<'labels'>[] {
  if (tasks.length === 0) return [];
  const firstLabels = tasks[0]?.labelIds ?? [];
  return firstLabels.filter((labelId) =>
    tasks.every((t) => (t.labelIds ?? []).includes(labelId)),
  );
}
