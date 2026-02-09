import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { ChevronsRight, Plus } from "lucide-react";
import { useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { useAppStore } from "@/frontend/stores/app";
import { CreateTaskDialog } from "./CreateTaskDialog";
import { KanbanColumn } from "./KanbanColumn";
import { Button } from "./ui/button";

const COLUMNS = [
  { status: "backlog" as const, label: "Backlog" },
  { status: "todo" as const, label: "To Do" },
  { status: "in_progress" as const, label: "In Progress" },
  { status: "review" as const, label: "Review" },
  { status: "done" as const, label: "Done" },
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
        "w-10 min-w-[40px] min-h-full rounded-lg bg-muted/50 border",
        "flex flex-col items-center justify-center gap-2",
        "hover:bg-muted/80 transition-colors cursor-pointer",
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const repoTasks = useQuery(
    api.tasks.listByRepo,
    selectedRepoId ? { repoId: selectedRepoId } : "skip",
  );
  const allTasksQuery = useQuery(
    api.tasks.listAll,
    selectedRepoId ? "skip" : {},
  );
  const allTasks = selectedRepoId ? repoTasks : allTasksQuery;

  const repos = useQuery(api.repos.list);
  const repoMap = new Map(repos?.map((r) => [r._id, r]) ?? []);

  const getColumnTasks = (status: string) =>
    (allTasks ?? [])
      .filter((t) => t.status === status)
      .sort((a, b) => a.position - b.position);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 border-b">
        <h1 className="text-lg font-semibold">
          {selectedRepoId
            ? (repoMap.get(selectedRepoId)?.name ?? "Tasks")
            : "All Tasks"}
        </h1>
        <Button
          size="sm"
          onClick={() => setCreateDialogOpen(true)}
          disabled={!selectedRepoId}
        >
          <Plus className="h-4 w-4 mr-1" />
          New Task
        </Button>
      </div>
      <div className="flex-1 flex gap-4 p-4 overflow-x-auto">
        {COLUMNS.map((col) =>
          col.status === "backlog" && backlogCollapsed ? (
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
              collapsible={col.status === "backlog"}
              onCollapse={col.status === "backlog" ? toggleBacklog : undefined}
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
