import { api } from '@convex/_generated/api';
import { useMutation } from 'convex/react';
import { FolderOpen, Loader2 } from 'lucide-react';
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

export function AddRepoDialog({ open, onOpenChange }: AddRepoDialogProps) {
  const [name, setName] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const createRepo = useMutation(api.repos.create);

  const handlePick = async () => {
    setPicking(true);
    setError(null);
    try {
      const res = await fetch('/api/pick-directory', { method: 'POST' });
      const data = await res.json();

      if (data.cancelled) {
        setPicking(false);
        return;
      }

      if (data.error) {
        setError(data.error);
        setPicking(false);
        return;
      }

      if (!data.isGitRepo) {
        setError('Selected folder is not a git repository.');
        setPicking(false);
        return;
      }

      setSelectedPath(data.path);
      setName(data.name);
    } catch {
      setError('Failed to open directory picker.');
    } finally {
      setPicking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !selectedPath || !selectedOrgId) {
      setError('Select a git repository and provide a name.');
      return;
    }

    setSubmitting(true);
    try {
      await createRepo({
        name: name.trim(),
        path: selectedPath,
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
    setSelectedPath(null);
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
              Select a local git repository to manage tasks for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Repository Folder</Label>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start gap-2 font-normal"
                onClick={handlePick}
                disabled={picking}
              >
                {picking ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                ) : (
                  <FolderOpen className="h-4 w-4 shrink-0" />
                )}
                {selectedPath ? (
                  <span className="truncate font-mono text-xs">
                    {selectedPath}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    Choose a folder...
                  </span>
                )}
              </Button>
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
              disabled={!selectedPath || !name.trim() || submitting}
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
