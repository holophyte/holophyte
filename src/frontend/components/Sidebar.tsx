import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  Plus,
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

      {/* Active tasks section */}
      {activeTasks && activeTasks.length > 0 && (
        <>
          <Separator />
          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Active
            </span>
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {activeTasks.length}
            </span>
          </div>
          <div className="px-2 space-y-0.5">
            {activeTasks.map((task) => (
              <button
                key={task._id}
                type="button"
                onClick={() => selectTask(task._id)}
                className={cn(
                  "w-full text-left rounded-md px-2 py-1.5 transition-colors",
                  selectedTaskId === task._id
                    ? "bg-accent"
                    : "hover:bg-accent/50",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      task.status === "in_progress"
                        ? "bg-blue-500"
                        : "bg-amber-500",
                    )}
                  />
                  <span className="truncate text-sm">{task.title}</span>
                </div>
                {task.repoName && (
                  <span className="text-[10px] text-muted-foreground ml-3">
                    {task.repoName}
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <Separator />
      <div className="flex items-center justify-between px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Repos
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
          {repos?.map((repo) => (
            <div key={repo._id} className="group relative">
              <Button
                variant={selectedRepoId === repo._id ? "secondary" : "ghost"}
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
          ))}
          {repos?.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">
              No repos added yet.
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
