import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import {
  ChevronRight,
  Folder,
  FolderGit2,
  FolderUp,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ScrollArea } from "./ui/scroll-area";

interface DirEntry {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [name, setName] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const createRepo = useMutation(api.repos.create);

  const browse = useCallback(async (path?: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path ?? "" }),
      });
      const data: BrowseResult = await res.json();
      setBrowseData(data);
    } catch {
      setError("Failed to browse directories.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      browse();
      setSelectedPath(null);
      setName("");
      setError(null);
    }
  }, [open, browse]);

  const handleSelect = (entry: DirEntry) => {
    if (entry.isGitRepo) {
      setSelectedPath(entry.path);
      if (!name) {
        setName(entry.name);
      }
    } else {
      browse(entry.path);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !selectedPath) {
      setError("Select a git repository and provide a name.");
      return;
    }

    try {
      await createRepo({ name: name.trim(), path: selectedPath });
      setName("");
      setSelectedPath(null);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add repo.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
            <DialogDescription>
              Browse and select a local git repository.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Folder browser */}
            <div className="space-y-2">
              <Label>Select Repository</Label>
              <div className="rounded-md border">
                {/* Current path breadcrumb */}
                <div className="flex items-center gap-1 px-3 py-2 border-b bg-muted/30 text-xs text-muted-foreground font-mono truncate">
                  {browseData?.current ?? "Loading..."}
                </div>

                <ScrollArea className="h-64">
                  {loading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="p-1">
                      {/* Parent directory */}
                      {browseData?.parent && (
                        <button
                          type="button"
                          className="flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-accent text-left"
                          onClick={() => browse(browseData.parent ?? undefined)}
                        >
                          <FolderUp className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-muted-foreground">..</span>
                        </button>
                      )}

                      {browseData?.dirs.map((entry) => (
                        <button
                          type="button"
                          key={entry.path}
                          className={cn(
                            "flex items-center gap-2 w-full rounded px-2 py-1.5 text-sm hover:bg-accent text-left",
                            selectedPath === entry.path &&
                              "bg-primary/10 ring-1 ring-primary/30",
                          )}
                          onClick={() => handleSelect(entry)}
                          onDoubleClick={() => {
                            if (!entry.isGitRepo) browse(entry.path);
                          }}
                        >
                          {entry.isGitRepo ? (
                            <FolderGit2 className="h-4 w-4 text-orange-500 shrink-0" />
                          ) : (
                            <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                          )}
                          <span className="truncate flex-1">{entry.name}</span>
                          {!entry.isGitRepo && (
                            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          )}
                        </button>
                      ))}

                      {browseData?.dirs.length === 0 && (
                        <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                          No subdirectories found.
                        </p>
                      )}
                    </div>
                  )}
                </ScrollArea>
              </div>

              {selectedPath && (
                <p className="text-xs text-muted-foreground font-mono">
                  Selected: {selectedPath}
                </p>
              )}
            </div>

            {/* Name field */}
            <div className="space-y-2">
              <Label htmlFor="repo-name">Name</Label>
              <Input
                id="repo-name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!selectedPath || !name.trim()}>
              Add Repo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
