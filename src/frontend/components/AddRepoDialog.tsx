import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
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

interface AddRepoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Extract a display name from an absolute repo path. */
function nameFromPath(path: string): string {
  const segments = path.replace(/\/+$/, '').split('/');
  return segments[segments.length - 1] ?? '';
}

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const createRepo = useMutation(api.repos.create);

  const handlePathChange = (value: string) => {
    setPath(value);
    // Auto-fill name from the last path segment if name is empty or was auto-filled
    const derived = nameFromPath(value);
    if (!name || name === nameFromPath(path)) {
      setName(derived);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedPath = path.trim().replace(/\/+$/, '');
    if (!name.trim() || !trimmedPath || !selectedOrgId) {
      setError('Enter a repository path and name.');
      return;
    }

    if (!trimmedPath.startsWith('/')) {
      setError('Path must be an absolute path (starting with /).');
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
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add Repository</DialogTitle>
            <DialogDescription>
              Enter the absolute path to a local git repository.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="repo-path">Repository Path</Label>
              <Input
                id="repo-path"
                placeholder="/Users/you/projects/my-repo"
                value={path}
                onChange={(e) => handlePathChange(e.target.value)}
                className="font-mono text-xs"
              />
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
