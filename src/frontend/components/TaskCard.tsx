import { api } from '@convex/_generated/api';
import { TaskStatus } from '@convex/schema';
import { useQuery } from 'convex/react';
import { CheckSquare, Clock, Terminal } from 'lucide-react';
import { formatRelativeDate } from '@/frontend/lib/dateUtils';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import type { EnrichedTask } from './KanbanBoard';
import Badge from './ui/Badge';

interface TaskCardProps {
  task: EnrichedTask;
  repoName?: string;
}

export function TaskCard({ task, repoName }: TaskCardProps) {
  const selectTask = useAppStore((s) => s.selectTask);
  const toggleBulkSelectTask = useAppStore((s) => s.toggleBulkSelectTask);
  const bulkSelectedTaskIds = useAppStore((s) => s.bulkSelectedTaskIds);
  const session = useQuery(api.sessions.getByTask, { taskId: task._id });

  const isBulkMode = bulkSelectedTaskIds.length > 0;
  const isSelected = bulkSelectedTaskIds.includes(task._id);

  const isOverdue =
    task.dueAt &&
    task.dueAt < Date.now() &&
    task.status !== TaskStatus.Done &&
    task.status !== TaskStatus.Archived;

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', task._id);
    e.dataTransfer.setData('application/x-status', task.status);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleClick = () => {
    if (isBulkMode) {
      toggleBulkSelectTask(task._id);
    } else {
      selectTask(task._id);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleBulkSelectTask(task._id);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={!isBulkMode}
      data-task-id={task._id}
      onDragStart={handleDragStart}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (isBulkMode) {
            toggleBulkSelectTask(task._id);
          } else {
            selectTask(task._id);
          }
        }
      }}
      className={cn(
        'group/card relative bg-background rounded-md border p-3 cursor-pointer hover:border-foreground/20 transition-colors shadow-sm',
        'active:cursor-grabbing',
        isSelected && 'ring-2 ring-primary border-primary/50',
      )}
    >
      {/* Bulk selection checkbox */}
      <div
        role="checkbox"
        aria-checked={isSelected}
        tabIndex={-1}
        onClick={handleCheckboxClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            toggleBulkSelectTask(task._id);
          }
        }}
        className={cn(
          'absolute top-2 right-2 h-4 w-4 rounded border flex items-center justify-center transition-all',
          isSelected
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-muted-foreground/30 bg-background',
          isBulkMode ? 'opacity-100' : 'opacity-0 group-hover/card:opacity-100',
        )}
      >
        {isSelected && (
          <svg
            aria-hidden="true"
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={3}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M5 13l4 4L19 7"
            />
          </svg>
        )}
      </div>
      {/* Label color dots */}
      {task.labels && task.labels.length > 0 && (
        <div className="flex gap-1 mb-1.5">
          {task.labels.map((label) => (
            <span
              key={label._id}
              className="h-1.5 w-6 rounded-full"
              style={{ backgroundColor: label.color }}
              title={label.name}
            />
          ))}
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium leading-snug">{task.title}</h3>
        {session?.status === 'running' && (
          <Terminal className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
        )}
      </div>
      {task.description && (
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
          {task.description}
        </p>
      )}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {repoName && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {repoName}
          </Badge>
        )}
        {task.prompt && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            prompt
          </Badge>
        )}
        {task.subtaskTotal > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
            <CheckSquare className="h-2.5 w-2.5" />
            {task.subtaskCompleted}/{task.subtaskTotal}
          </Badge>
        )}
        {task.dueAt && (
          <Badge
            variant="outline"
            className={cn(
              'text-[10px] px-1.5 py-0 gap-0.5',
              isOverdue && 'text-red-600 border-red-300 bg-red-50',
            )}
          >
            <Clock className="h-2.5 w-2.5" />
            {formatRelativeDate(task.dueAt)}
          </Badge>
        )}
        {session && (
          <Badge
            variant={session.status === 'running' ? 'default' : 'outline'}
            className={cn(
              'text-[10px] px-1.5 py-0',
              session.status === 'completed' && 'text-green-600',
              session.status === 'failed' && 'text-red-600',
              session.status === 'stopped' && 'text-yellow-600',
            )}
          >
            {session.status}
          </Badge>
        )}
      </div>
    </div>
  );
}
