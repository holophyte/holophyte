import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { ArchiveRestore, ArrowLeft, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "@/frontend/stores/app";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function ArchivePanel() {
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const toggleArchive = useAppStore((s) => s.toggleArchive);
  const [search, setSearch] = useState("");

  const archivedTasks = useQuery(
    api.tasks.listArchived,
    selectedRepoId ? { repoId: selectedRepoId } : {},
  );

  const repos = useQuery(api.repos.list);
  const repoMap = new Map(repos?.map((r) => [r._id, r]) ?? []);

  const unarchiveTask = useMutation(api.tasks.unarchive);
  const removeTask = useMutation(api.tasks.remove);

  const filteredTasks = (archivedTasks ?? []).filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.prompt.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-3 border-b">
        <Button size="sm" variant="ghost" onClick={toggleArchive}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <h1 className="text-lg font-semibold">Archive</h1>
        <span className="text-sm text-muted-foreground">
          {filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}
        </span>
        <div className="flex-1" />
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search archived..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {filteredTasks.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            <p className="text-sm">No archived tasks</p>
          </div>
        ) : (
          <div className="space-y-2 max-w-3xl mx-auto">
            {filteredTasks.map((task) => (
              <div
                key={task._id}
                className="flex items-center gap-3 rounded-lg border bg-background p-3"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-medium truncate">{task.title}</h3>
                  {task.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {task.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 mt-1">
                    <Badge
                      variant="outline"
                      className="text-[10px] px-1.5 py-0"
                    >
                      {repoMap.get(task.repoId)?.name ?? "Unknown"}
                    </Badge>
                    {task.archivedAt && (
                      <span className="text-[10px] text-muted-foreground">
                        Archived{" "}
                        {new Date(task.archivedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => unarchiveTask({ id: task._id })}
                  title="Restore to Done"
                >
                  <ArchiveRestore className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeTask({ id: task._id })}
                  title="Delete permanently"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
