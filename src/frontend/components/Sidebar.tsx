import { useQuery } from "convex/react";
import { FolderGit2, LayoutDashboard, Plus } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { useAppStore } from "@/frontend/stores/app";
import { AddRepoDialog } from "./AddRepoDialog";
import { Button } from "./ui/button";
import { ScrollArea } from "./ui/scroll-area";
import { Separator } from "./ui/separator";
import { cn } from "@/frontend/lib/utils";

export function Sidebar() {
  const repos = useQuery(api.repos.list);
  const selectedRepoId = useAppStore((s) => s.selectedRepoId);
  const selectRepo = useAppStore((s) => s.selectRepo);
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  return (
    <aside className="w-64 border-r bg-muted/30 flex flex-col">
      <div className="p-4 font-semibold text-lg flex items-center gap-2">
        <FolderGit2 className="h-5 w-5" />
        Holophyte
      </div>
      <Separator />
      <div className="p-2">
        <Button
          variant={selectedRepoId === null ? "secondary" : "ghost"}
          className="w-full justify-start gap-2"
          onClick={() => selectRepo(null)}
        >
          <LayoutDashboard className="h-4 w-4" />
          All Tasks
        </Button>
      </div>
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
            <Button
              key={repo._id}
              variant={selectedRepoId === repo._id ? "secondary" : "ghost"}
              className={cn("w-full justify-start gap-2 text-sm")}
              onClick={() => selectRepo(repo._id)}
            >
              <FolderGit2 className="h-4 w-4 shrink-0" />
              <span className="truncate">{repo.name}</span>
            </Button>
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
