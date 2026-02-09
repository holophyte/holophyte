import { api } from "@convex/_generated/api";
import { useQuery } from "convex/react";
import { Plus } from "lucide-react";
import { useState } from "react";
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

export function KanbanBoard() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
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
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.status}
            status={col.status}
            label={col.label}
            tasks={(allTasks ?? [])
              .filter((t) => t.status === col.status)
              .sort((a, b) => a.position - b.position)}
            repoMap={repoMap}
            showRepoBadge={selectedRepoId === null}
          />
        ))}
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
