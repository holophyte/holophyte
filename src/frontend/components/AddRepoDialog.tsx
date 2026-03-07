import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { FolderOpen, Info, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { homeDir } from '@/frontend/lib/config';
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

/** Expand leading `~` or `~/` to the server's home directory. */
export function expandTilde(path: string): string {
  if (!homeDir) return path;
  if (path === '~') return homeDir;
  if (path.startsWith('~/')) return homeDir + path.slice(1);
  return path;
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [picking, setPicking] = useState(false);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
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
      const res = await fetch('/api/pick-directory', { method: 'POST' });
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
      setError('Failed to open directory picker.');
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
      const isTilde = path.trim().startsWith('~');
      setError(
        isTilde && !homeDir
          ? 'Could not resolve ~ — enter the full absolute path instead.'
          : 'Path must be absolute (start with / or ~/).',
      );
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
        setError('This repository has already been added.');
      } else {
        setError(message);
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
                      Absolute path to a git repo. Use ~ for home directory
                      (e.g. ~/projects/my-repo) or a full path (e.g.
                      /Users/you/projects/my-repo).
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="flex gap-2">
                <Input
                  id="repo-path"
                  placeholder="~/projects/my-repo"
                  value={path}
                  onChange={(e) => handlePathChange(e.target.value)}
                  className="font-mono text-xs"
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
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
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
