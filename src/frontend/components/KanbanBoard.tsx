import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useMutation, useQuery } from 'convex/react';
import { Archive, ChevronsRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import { ArchivePanel } from './ArchivePanel';
import { CreateTaskDialog } from './CreateTaskDialog';
import { KanbanColumn } from './KanbanColumn';
import { SearchFilterBar } from './SearchFilterBar';
import Button from './ui/Button';

export interface EnrichedTask extends Doc<'tasks'> {
  labels: Doc<'labels'>[];
  subtaskTotal: number;
  subtaskCompleted: number;
}

const COLUMNS = [
  { status: TaskStatus.Backlog, label: 'Backlog' },
  { status: TaskStatus.Todo, label: 'To Do' },
  { status: TaskStatus.InProgress, label: 'In Progress' },
  { status: TaskStatus.Review, label: 'Review' },
  { status: TaskStatus.Done, label: 'Done' },
];

function CollapsedColumn({
  label,
  count,
  onExpand,
}: {
  label: string;
  count: number;
  onExpand: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        'w-10 min-w-[40px] min-h-full rounded-lg bg-muted/50 border',
        'flex flex-col items-center justify-center gap-2',
        'hover:bg-muted/80 transition-colors cursor-pointer',
      )}
    >
      <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
        {count}
      </span>
      <span className="text-xs font-medium text-muted-foreground [writing-mode:vertical-lr] rotate-180">
        {label}
      </span>
      <ChevronsRight className="h-3.5 w-3.5 text-muted-foreground" />
    </button>
  );
}

export function KanbanBoard() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const backlogCollapsed = useAppStore((s) => s.backlogCollapsed);
  const toggleBacklog = useAppStore((s) => s.toggleBacklog);
  const showArchive = useAppStore((s) => s.showArchive);
  const toggleArchive = useAppStore((s) => s.toggleArchive);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const filterLabelIds = useAppStore((s) => s.filterLabelIds);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const repoTasks = useQuery(
    api.tasks.listByRepo,
    selectedRepoId ? { repoId: selectedRepoId } : 'skip',
  );
  const allTasksQuery = useQuery(
    api.tasks.listAll,
    selectedRepoId ? 'skip' : {},
  );
  const allTasks = selectedRepoId ? repoTasks : allTasksQuery;

  const repos = useQuery(api.repos.list);
  const repoMap = new Map(repos?.map((r) => [r._id, r]) ?? []);

  const labels = useQuery(api.labels.list);
  const labelMap = useMemo(
    () => new Map(labels?.map((l) => [l._id, l]) ?? []),
    [labels],
  );

  const taskIds = useMemo(() => (allTasks ?? []).map((t) => t._id), [allTasks]);
  const subtaskCounts = useQuery(
    api.subtasks.countsByTasks,
    taskIds.length > 0 ? { taskIds } : 'skip',
  );

  const enrichedTasks: EnrichedTask[] = useMemo(() => {
    return (allTasks ?? []).map((t) => {
      const counts = subtaskCounts?.[t._id];
      return {
        ...t,
        labels: (t.labelIds ?? [])
          .map((id) => labelMap.get(id))
          .filter((l): l is Doc<'labels'> => l != null),
        subtaskTotal: counts?.total ?? 0,
        subtaskCompleted: counts?.completed ?? 0,
      };
    });
  }, [allTasks, labelMap, subtaskCounts]);

  const getColumnTasks = (status: string): EnrichedTask[] => {
    let filtered = enrichedTasks.filter((t) => t.status === status);

    // Text search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.prompt.toLowerCase().includes(q) ||
          t.labels.some((l) => l.name.toLowerCase().includes(q)),
      );
    }

    // Label filter
    if (filterLabelIds.length > 0) {
      filtered = filtered.filter((t) =>
        filterLabelIds.some((lid) => (t.labelIds ?? []).includes(lid)),
      );
    }

    return filtered.sort((a, b) => a.position - b.position);
  };

  const archiveAllDone = useMutation(api.tasks.archiveAllDone);

  const handleArchiveAll = async () => {
    if (!selectedRepoId) return;
    await archiveAllDone({ repoId: selectedRepoId });
  };

  if (showArchive) {
    return <ArchivePanel />;
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b gap-3">
        <h1 className="text-lg font-semibold shrink-0">
          {selectedRepoId
            ? (repoMap.get(selectedRepoId)?.name ?? 'Tasks')
            : 'All Tasks'}
        </h1>
        <SearchFilterBar />
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant={showArchive ? 'secondary' : 'ghost'}
            onClick={toggleArchive}
          >
            <Archive className="h-4 w-4 mr-1" />
            Archive
          </Button>
          <Button
            size="sm"
            onClick={() => setCreateDialogOpen(true)}
            disabled={!selectedRepoId}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Task
          </Button>
        </div>
      </div>
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {COLUMNS.map((col) =>
          col.status === 'backlog' && backlogCollapsed ? (
            <CollapsedColumn
              key={col.status}
              label={col.label}
              count={getColumnTasks(col.status).length}
              onExpand={toggleBacklog}
            />
          ) : (
            <KanbanColumn
              key={col.status}
              status={col.status}
              label={col.label}
              tasks={getColumnTasks(col.status)}
              repoMap={repoMap}
              showRepoBadge={selectedRepoId === null}
              collapsible={col.status === 'backlog'}
              onCollapse={col.status === 'backlog' ? toggleBacklog : undefined}
              onArchiveAll={
                col.status === 'done' && selectedRepoId
                  ? handleArchiveAll
                  : undefined
              }
            />
          ),
        )}
      </div>
      {selectedRepoId && (
        <CreateTaskDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          repoId={selectedRepoId}
        />
      )}
    </div>
  );
}
