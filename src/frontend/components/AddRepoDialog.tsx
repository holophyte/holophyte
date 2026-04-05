import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { FolderOpen, Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useCompanionStatus } from '@/frontend/hooks/useCompanionStatus';
import { toast } from '@/frontend/lib/toast';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/Dialog';
import Input from './ui/Input';
import Label from './ui/Label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/Tooltip';

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Extract a display name from an absolute repo path. */
export function nameFromPath(path: string): string {
  const segments = path.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] ?? '';
}

/**
 * Expand leading `~` or `~/` to the home directory.
 *
 * Tilde expansion is no longer supported — the frontend has no access to the
 * server's home directory. This function is kept for API compatibility but
 * always returns the path unchanged. Users must enter absolute paths.
 */
export function expandTilde(path: string): string {
  return path;
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const { state: companionState, companionUrl } =
    useCompanionStatus(selectedOrgId);
  const createRepo = useMutation(api.repos.create);

  const handlePathChange = (value: string) => {
    setPath(value);
    const derived = nameFromPath(value);
    if (!name || name === nameFromPath(path)) {
      setName(derived);
    }
  };

  const handlePickDirectory = async () => {
    setPicking(true);
    setError(null);
    try {
      const baseUrl = companionUrl ?? '';
      // UX hint only — real localhost validation is enforced server-side
      // in the companion heartbeat mutation (convex/companion.ts)
      if (baseUrl && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(baseUrl)) {
        toast.error('Companion URL is invalid.');
        return;
      }
      const res = await fetch(`${baseUrl}/api/pick-directory`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error('Failed to open directory picker.');
      const data = await res.json();
      if (data.cancelled) {
        return;
      }
      setPath(data.path);
      setName(data.name);
      if (!data.isGitRepo) {
        setError('Selected folder is not a git repository.');
      }
    } catch {
      toast.error(
        companionState !== 'connected'
          ? 'Companion is not connected. Start the companion to use the directory picker.'
          : 'Failed to open directory picker.',
      );
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedPath = expandTilde(path.trim()).replace(/\/+$/, '');
    if (!name.trim() || !trimmedPath || !selectedOrgId) {
      setError('Enter a repository path and name.');
      return;
    }

    if (!trimmedPath.startsWith('/')) {
      setError('Path must be absolute (start with /).');
      return;
    }

    setSubmitting(true);
    try {
      await createRepo({
        name: name.trim(),
        path: trimmedPath,
        orgId: selectedOrgId,
      });
      handleClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to add repo.';
      if (message.includes('already exists')) {
        toast.error('This repository has already been added.');
      } else {
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setName('');
    setPath('');
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById('repo-path')?.focus();
        }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
            <DialogDescription>
              Choose a local git repository to add.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="repo-path">Repository Path</Label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="inline-flex">
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      Absolute path to a local git repo (e.g.
                      /Users/you/projects/my-repo).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex gap-2">
                <Input
                  id="repo-path"
                  placeholder="/Users/you/projects/my-repo"
                  value={path}
                  onChange={(e) => handlePathChange(e.target.value)}
                  className="font-mono text-xs"
                  aria-invalid={!!error}
                  aria-describedby={error ? 'add-repo-error' : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  onClick={handlePickDirectory}
                  disabled={picking}
                  title="Browse..."
                >
                  {picking ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderOpen className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="repo-name">Name</Label>
              <Input
                id="repo-name"
                placeholder="my-project"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? 'add-repo-error' : undefined}
              />
            </div>

            {error && (
              <p id="add-repo-error" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!path.trim() || !name.trim() || submitting}
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Repo'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
