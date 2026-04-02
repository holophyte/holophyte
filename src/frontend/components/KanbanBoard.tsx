import { api } from '@convex/_generated/api';
import type { Doc, Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import { Archive, ChevronsRight, FolderGit2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SortPreference } from '@/frontend/lib/taskSort';
import { sortTasks } from '@/frontend/lib/taskSort';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import { ArchivePanel } from './ArchivePanel';
import BulkActionBar from './BulkActionBar';
import { CreateTaskDialog } from './CreateTaskDialog';
import { KanbanColumn } from './KanbanColumn';
import { SearchFilterBar } from './SearchFilterBar';
import SortDropdown from './SortDropdown';
import Button from './ui/Button';
import PageHeader from './ui/PageHeader';

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

function CollapsibleColumn({
  collapsed,
  onToggle,
  label,
  count,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative shrink-0 transition-[width,min-width,max-width,flex] duration-300 ease-in-out overflow-hidden',
        collapsed
          ? 'w-10 min-w-[40px] max-w-[40px] flex-none'
          : 'w-[260px] min-w-[260px] max-w-[350px] flex-1',
      )}
    >
      <div aria-hidden={!collapsed || undefined} className="contents">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Expand ${label} column (${count} tasks)`}
          tabIndex={collapsed ? 0 : -1}
          className={cn(
            'absolute inset-0 w-10 rounded-lg bg-muted/30 border border-dashed',
            'flex flex-col items-center justify-center gap-2',
            'hover:bg-muted/80 cursor-pointer',
            'transition-opacity duration-300',
            collapsed
              ? 'opacity-100 delay-100'
              : 'opacity-0 pointer-events-none',
          )}
        >
          <span
            aria-hidden="true"
            className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5"
          >
            {count}
          </span>
          <span
            aria-hidden="true"
            className="text-xs font-medium text-muted-foreground [writing-mode:vertical-lr] rotate-180"
          >
            {label}
          </span>
          <ChevronsRight
            aria-hidden="true"
            className="h-3.5 w-3.5 text-muted-foreground"
          />
        </button>
      </div>
      <div
        aria-hidden={collapsed || undefined}
        inert={collapsed || undefined}
        className={cn(
          'h-full transition-opacity duration-300',
          collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100 delay-100',
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function KanbanBoard() {
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const { repoId } = useParams({ strict: false });
  const selectedRepoId = (repoId as Id<'repos'> | undefined) ?? null;
  const collapsedColumns = useAppStore((s) => s.collapsedColumns);
  const toggleColumnCollapsed = useAppStore((s) => s.toggleColumnCollapsed);
  const showArchive = useAppStore((s) => s.showArchive);
  const toggleArchive = useAppStore((s) => s.toggleArchive);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const filterLabelIds = useAppStore((s) => s.filterLabelIds);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createDialogStatus, setCreateDialogStatus] = useState<TaskStatus>(
    TaskStatus.Backlog,
  );

  const repoTasks = useQuery(
    api.tasks.listByRepo,
    selectedRepoId ? { repoId: selectedRepoId } : 'skip',
  );
  const allTasksQuery = useQuery(
    api.tasks.listAll,
    selectedRepoId || !selectedOrgId ? 'skip' : { orgId: selectedOrgId },
  );
  const allTasks = selectedRepoId ? repoTasks : allTasksQuery;

  const repos = useQuery(
    api.repos.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );
  const repoMap = new Map(repos?.map((r) => [r._id, r]) ?? []);

  const currentRepo = selectedRepoId ? repoMap.get(selectedRepoId) : undefined;
  const sortPreference: SortPreference =
    currentRepo?.sortPreference ?? 'manual';

  const updateSortPreference = useMutation(api.repos.updateSortPreference);

  const handleSortChange = (pref: SortPreference) => {
    if (!selectedRepoId) return;
    updateSortPreference({ id: selectedRepoId, sortPreference: pref });
  };

  const labels = useQuery(
    api.labels.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );
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

  const getColumnTasks = (status: TaskStatus): EnrichedTask[] => {
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

    return sortTasks(filtered, sortPreference);
  };

  const archiveAllDone = useMutation(api.tasks.archiveAllDone);

  const handleArchiveAll = async () => {
    if (!selectedRepoId) return;
    await archiveAllDone({ repoId: selectedRepoId });
  };

  if (showArchive) {
    return <ArchivePanel />;
  }

  const hasNoRepos =
    !selectedRepoId && repos !== undefined && repos.length === 0;
  const canAddTask = selectedRepoId
    ? currentRepo !== undefined
    : (repos?.length ?? 0) > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative">
      <PageHeader
        data-testid="kanban-header"
        className="justify-between px-6 gap-3"
      >
        <h1 className="text-lg font-semibold shrink-0">
          {selectedRepoId
            ? (repoMap.get(selectedRepoId)?.name ?? 'Tasks')
            : 'All Tasks'}
        </h1>
        <SearchFilterBar />
        <div className="flex items-center gap-2 shrink-0">
          {selectedRepoId && (
            <SortDropdown value={sortPreference} onChange={handleSortChange} />
          )}
          <Button
            size="sm"
            variant={showArchive ? 'secondary' : 'ghost'}
            onClick={toggleArchive}
          >
            <Archive className="h-4 w-4 mr-1" />
            Archive
          </Button>
        </div>
      </PageHeader>
      {hasNoRepos ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <FolderGit2 className="h-10 w-10" />
          <p className="text-sm">
            No projects yet. Add a repository to get started.
          </p>
        </div>
      ) : (
        <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
          {COLUMNS.map((col) => {
            const columnTasks = getColumnTasks(col.status);
            const isCollapsed = collapsedColumns.has(col.status);
            const handleToggleCollapse = () =>
              toggleColumnCollapsed(col.status);
            const columnEl = (
              <KanbanColumn
                status={col.status}
                label={col.label}
                tasks={columnTasks}
                repoMap={repoMap}
                showRepoBadge={selectedRepoId === null}
                variant={
                  col.status === TaskStatus.Backlog ? 'backlog' : 'default'
                }
                sortActive={sortPreference !== 'manual'}
                onCollapse={handleToggleCollapse}
                onArchiveAll={
                  col.status === TaskStatus.Done && selectedRepoId
                    ? handleArchiveAll
                    : undefined
                }
                onAddTask={() => {
                  setCreateDialogStatus(col.status);
                  setCreateDialogOpen(true);
                }}
                addTaskDisabled={!canAddTask}
              />
            );

            return (
              <CollapsibleColumn
                key={col.status}
                collapsed={isCollapsed}
                onToggle={handleToggleCollapse}
                label={col.label}
                count={columnTasks.length}
              >
                {columnEl}
              </CollapsibleColumn>
            );
          })}
        </div>
      )}
      <BulkActionBar allTasks={enrichedTasks} />
      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        repoId={selectedRepoId ?? undefined}
        initialStatus={createDialogStatus}
      />
    </div>
  );
}
