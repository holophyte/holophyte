import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  Eye,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  Plus,
  Sprout,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { useAppStore } from "@/frontend/stores/app";
import { AddRepoDialog } from "./AddRepoDialog";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";

export function Sidebar() {
  const repos = useQuery(api.repos.list);
  const activeTasks = useQuery(api.tasks.listActive);
  const removeRepo = useMutation(api.repos.remove);
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const viewMode = useAppStore((s) => s.viewMode);
  const selectRepo = useAppStore((s) => s.selectRepo);
  const selectSeedBox = useAppStore((s) => s.selectSeedBox);
  const selectTask = useAppStore((s) => s.selectTask);
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  const handleRemove = async (e: React.MouseEvent, repoId: Id<"repos">) => {
    e.stopPropagation();
    if (selectedRepoId === repoId) {
      selectRepo(null);
    }
    await removeRepo({ id: repoId });
  };

  // Group active tasks by repo
  const activeTasksByRepo = new Map<string, typeof activeTasks>();
  for (const task of activeTasks ?? []) {
    const repoId = String(task.repoId);
    const existing = activeTasksByRepo.get(repoId) ?? [];
    existing.push(task);
    activeTasksByRepo.set(repoId, existing);
  }

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 font-semibold text-lg flex items-center gap-2">
        <FolderGit2 className="h-5 w-5" />
        Holophyte
      </div>
      <Separator />
      <div className="p-2 space-y-1">
        <Button
          variant={
            viewMode === "board" && selectedRepoId === null
              ? "secondary"
              : "ghost"
          }
          className="w-full justify-start gap-2"
          onClick={() => selectRepo(null)}
        >
          <LayoutDashboard className="h-4 w-4" />
          All Tasks
        </Button>
        <Button
          variant={viewMode === "seeds" ? "secondary" : "ghost"}
          className="w-full justify-start gap-2"
          onClick={() => selectSeedBox()}
        >
          <Lightbulb className="h-4 w-4" />
          Seed Box
        </Button>
      </div>

      <Separator />
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setAddRepoOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {repos?.map((repo) => {
            const repoActiveTasks =
              activeTasksByRepo.get(String(repo._id)) ?? [];
            return (
              <div key={repo._id}>
                <div className="group relative">
                  <Button
                    variant={
                      selectedRepoId === repo._id ? "secondary" : "ghost"
                    }
                    className={cn("w-full justify-start gap-2 text-sm pr-8")}
                    onClick={() => selectRepo(repo._id)}
                  >
                    <FolderGit2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{repo.name}</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                    onClick={(e) => handleRemove(e, repo._id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                {repoActiveTasks.length > 0 && (
                  <div className="ml-4 pl-2 border-l border-border/50 space-y-0.5 my-0.5">
                    {repoActiveTasks.map((task) => (
                      <button
                        key={task._id}
                        type="button"
                        onClick={() => selectTask(task._id)}
                        className={cn(
                          "w-full text-left rounded-md px-2 py-1 transition-colors flex items-center gap-1.5",
                          selectedTaskId === task._id
                            ? "bg-accent"
                            : "hover:bg-accent/50",
                        )}
                      >
                        {task.status === "in_progress" ? (
                          <Sprout
                            className={cn(
                              "h-3 w-3 shrink-0 text-green-500",
                              task.hasRunningSession && "animate-pulse",
                            )}
                          />
                        ) : (
                          <Eye className="h-3 w-3 shrink-0 text-amber-500" />
                        )}
                        <span className="truncate text-xs text-muted-foreground">
                          {task.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {repos?.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No projects added yet.
              <br />
              Click + to add one.
            </p>
          )}
        </div>
      </ScrollArea>
      <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
    </aside>
  );
}
