import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import {
  Check,
  Leaf,
  Pencil,
  Plus,
  Sprout,
  Trash2,
  TreePine,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/frontend/lib/utils";
import { Badge } from "./ui/badge";
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
import { Textarea } from "./ui/textarea";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

// ── Create Seed Inline ──────────────────────────────────────────────

function CreateSeedInline({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const createSeed = useMutation(api.seeds.create);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async () => {
    if (!title.trim()) return;
    await createSeed({ title: title.trim() });
    setTitle("");
    onDone();
  };

  return (
    <div className="rounded-lg border border-dashed border-primary/30 bg-primary/[0.03] p-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="flex items-center gap-2"
      >
        <Sprout className="h-4 w-4 text-primary/40 shrink-0" />
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What's the idea?"
          className="h-8 border-0 bg-transparent shadow-none focus-visible:ring-0 px-0 text-sm placeholder:text-muted-foreground/50"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={!title.trim()}
          className="h-7 w-7 p-0 shrink-0"
        >
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onDone}
          className="h-7 w-7 p-0 shrink-0 text-muted-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}

// ── Plant Dialog ─────────────────────────────────────────────────────

function PlantDialog({
  seed,
  open,
  onOpenChange,
}: {
  seed: Doc<"seeds">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const repos = useQuery(api.repos.list);
  const plantSeed = useMutation(api.seeds.plant);
  const [selectedRepoId, setSelectedRepoId] = useState<Id<"repos"> | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");

  const handlePlant = async () => {
    if (!selectedRepoId) return;
    await plantSeed({
      id: seed._id,
      repoId: selectedRepoId,
      prompt: prompt.trim() || undefined,
    });
    setSelectedRepoId(null);
    setPrompt("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TreePine className="h-4 w-4" />
            Plant Seed
          </DialogTitle>
          <DialogDescription>
            Create a task from &ldquo;{seed.title}&rdquo; and assign it to a
            repository.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Repository</Label>
            <div className="grid grid-cols-1 gap-1.5">
              {repos?.map((repo) => (
                <button
                  key={repo._id}
                  type="button"
                  onClick={() => setSelectedRepoId(repo._id)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2 text-sm text-left transition-colors",
                    selectedRepoId === repo._id
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-transparent bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      selectedRepoId === repo._id
                        ? "bg-primary"
                        : "bg-muted-foreground/30",
                    )}
                  />
                  <span className="truncate">{repo.name}</span>
                </button>
              ))}
              {repos?.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">
                  No repos available. Add one first.
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="plant-prompt">Claude Prompt (optional)</Label>
            <Textarea
              id="plant-prompt"
              placeholder="Prompt to send to Claude Code..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              className="font-mono text-xs"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handlePlant} disabled={!selectedRepoId}>
            <TreePine className="h-4 w-4 mr-1" />
            Plant
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Seed Card ────────────────────────────────────────────────────────

function SeedCard({ seed }: { seed: Doc<"seeds"> }) {
  const updateSeed = useMutation(api.seeds.update);
  const removeSeed = useMutation(api.seeds.remove);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(seed.title);
  const [description, setDescription] = useState(seed.description);
  const [plantOpen, setPlantOpen] = useState(false);

  const isPlanted = seed.status === "planted";

  useEffect(() => {
    setTitle(seed.title);
    setDescription(seed.description);
  }, [seed.title, seed.description]);

  const handleSave = async () => {
    if (!title.trim()) return;
    await updateSeed({
      id: seed._id,
      title: title.trim(),
      description: description.trim(),
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setTitle(seed.title);
    setDescription(seed.description);
    setEditing(false);
  };

  return (
    <>
      <div
        className={cn(
          "group relative rounded-lg border bg-background p-4 transition-all",
          isPlanted
            ? "opacity-50 border-dashed"
            : "shadow-sm hover:shadow-md hover:border-foreground/15",
        )}
      >
        {/* Delete button */}
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={() => removeSeed({ id: seed._id })}
        >
          <Trash2 className="h-3 w-3" />
        </Button>

        {editing && !isPlanted ? (
          <div className="space-y-2">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 text-sm font-medium"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") handleCancel();
              }}
            />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={2}
              className="text-xs resize-none"
              onKeyDown={(e) => {
                if (e.key === "Escape") handleCancel();
              }}
            />
            <div className="flex items-center gap-1.5 justify-end">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleCancel}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSave}
                disabled={!title.trim()}
                className="h-7 text-xs"
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <div className="flex items-start gap-2 pr-6">
              <Sprout
                className={cn(
                  "h-3.5 w-3.5 mt-0.5 shrink-0",
                  isPlanted ? "text-muted-foreground/50" : "text-green-600",
                )}
              />
              <h3 className="text-sm font-medium leading-snug">{seed.title}</h3>
            </div>
            {seed.description && (
              <p className="text-xs text-muted-foreground mt-1.5 ml-[22px] line-clamp-3">
                {seed.description}
              </p>
            )}

            <div className="flex items-center justify-between mt-3 ml-[22px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground/70">
                  {timeAgo(seed.createdAt)}
                </span>
                {isPlanted && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] px-1.5 py-0 gap-1"
                  >
                    <Leaf className="h-2.5 w-2.5" />
                    Planted
                  </Badge>
                )}
              </div>
              {!isPlanted && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setEditing(true)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 text-[10px] px-1.5 gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => setPlantOpen(true)}
                  >
                    <TreePine className="h-3 w-3" />
                    Plant
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <PlantDialog seed={seed} open={plantOpen} onOpenChange={setPlantOpen} />
    </>
  );
}

// ── Seed Board ───────────────────────────────────────────────────────

export function SeedBoard() {
  const seeds = useQuery(api.seeds.list);
  const [creating, setCreating] = useState(false);
  const [showPlanted, setShowPlanted] = useState(true);

  const activeSeeds = seeds?.filter((s) => s.status === "active") ?? [];
  const plantedSeeds = seeds?.filter((s) => s.status === "planted") ?? [];
  const visibleSeeds = showPlanted ? seeds : activeSeeds;
  const sortedSeeds = [...(visibleSeeds ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Seed Box</h1>
          {seeds && seeds.length > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">
              {activeSeeds.length} active
              {plantedSeeds.length > 0 && ` / ${plantedSeeds.length} planted`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {plantedSeeds.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPlanted(!showPlanted)}
              className={cn(
                "text-xs gap-1.5",
                !showPlanted && "text-muted-foreground",
              )}
            >
              <Leaf className="h-3.5 w-3.5" />
              {showPlanted ? "Hide" : "Show"} planted
            </Button>
          )}
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Idea
          </Button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {seeds === undefined ? null : seeds.length === 0 && !creating ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="rounded-full bg-muted/60 p-4 mb-4">
              <Sprout className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h2 className="text-sm font-medium text-muted-foreground mb-1">
              No seeds yet
            </h2>
            <p className="text-xs text-muted-foreground/70 max-w-[240px] mb-4">
              Capture ideas here. When they're ready, plant them as tasks in a
              repo.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCreating(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add your first idea
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 auto-rows-min">
            {creating && <CreateSeedInline onDone={() => setCreating(false)} />}
            {sortedSeeds.map((seed) => (
              <SeedCard key={seed._id} seed={seed} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
