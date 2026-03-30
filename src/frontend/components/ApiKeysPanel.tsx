import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Check, Copy, KeyRound, Loader2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import Badge from './ui/Badge';
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

type ApiKeyDoc = Omit<Doc<'apiKeys'>, 'hashedKey'>;

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface GenerateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function GenerateKeyDialog({ open, onOpenChange }: GenerateKeyDialogProps) {
  const [name, setName] = useState('');
  const [mcpScope, setMcpScope] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useAction(api.apiKeys.generate);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    const scopes = mcpScope ? ['mcp'] : [];
    if (scopes.length === 0) {
      setError('Select at least one scope.');
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      const rawKey = await generate({ name: name.trim(), scopes });
      setGeneratedKey(rawKey);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to generate key.';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!generatedKey) return;
    await navigator.clipboard.writeText(generatedKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = () => {
    setName('');
    setMcpScope(true);
    setSubmitting(false);
    setError(null);
    setGeneratedKey(null);
    setCopied(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        {generatedKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API Key Generated</DialogTitle>
              <DialogDescription>
                Copy this key now — it won't be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Store this key securely. You won't be able to view it again
                  after closing this dialog.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                <code className="flex-1 truncate font-mono text-xs select-all">
                  {generatedKey}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={handleCopy}
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-green-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleClose}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <DialogHeader>
              <DialogTitle>Generate API Key</DialogTitle>
              <DialogDescription>
                Create a new API key to authenticate external tools.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="key-name">Name</Label>
                <Input
                  id="key-name"
                  placeholder="e.g. My MCP client"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label>Scopes</Label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mcpScope}
                    onChange={(e) => setMcpScope(e.target.checked)}
                    className="h-4 w-4 rounded border border-input"
                  />
                  <span>MCP</span>
                  <span className="text-xs text-muted-foreground">
                    — allows use as an MCP server credential
                  </span>
                </label>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={!name.trim() || submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  'Generate Key'
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface KeyRowProps {
  apiKey: ApiKeyDoc;
  onRevoke: (keyId: ApiKeyDoc['_id']) => void;
  revoking: boolean;
}

function KeyRow({ apiKey, onRevoke, revoking }: KeyRowProps) {
  const isRevoked = apiKey.revokedAt !== undefined;

  return (
    <div
      className={cn(
        'flex items-center gap-4 rounded-md border p-4',
        isRevoked && 'opacity-50',
      )}
    >
      <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{apiKey.name}</span>
          {isRevoked ? (
            <Badge variant="outline" className="text-xs">
              revoked
            </Badge>
          ) : (
            <Badge variant="secondary" className="text-xs">
              active
            </Badge>
          )}
          {apiKey.scopes.map((scope) => (
            <Badge key={scope} variant="secondary" className="text-xs">
              {scope}
            </Badge>
          ))}
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
          <span>Created {formatDate(apiKey._creationTime)}</span>
          {apiKey.lastUsedAt !== undefined && (
            <span>Last used {formatDate(apiKey.lastUsedAt)}</span>
          )}
          {isRevoked && apiKey.revokedAt !== undefined && (
            <span>Revoked {formatDate(apiKey.revokedAt)}</span>
          )}
        </div>
      </div>
      {!isRevoked && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onRevoke(apiKey._id)}
          disabled={revoking}
        >
          {revoking ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Revoke'}
        </Button>
      )}
    </div>
  );
}

export default function ApiKeysPanel() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [revokingId, setRevokingId] = useState<ApiKeyDoc['_id'] | null>(null);

  const keys = useQuery(api.apiKeys.list);
  const revoke = useMutation(api.apiKeys.revoke);

  const handleRevoke = async (keyId: ApiKeyDoc['_id']) => {
    setRevokingId(keyId);
    try {
      await revoke({ keyId });
    } finally {
      setRevokingId(null);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">API Keys</h2>
          <p className="text-sm text-muted-foreground">
            Manage keys for authenticating external tools and MCP servers.
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <KeyRound className="h-4 w-4" />
          Generate Key
        </Button>
      </div>

      {keys === undefined ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 text-center">
          <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            No API keys yet. Generate one to get started.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map((key) => (
            <KeyRow
              key={key._id}
              apiKey={key}
              onRevoke={handleRevoke}
              revoking={revokingId === key._id}
            />
          ))}
        </div>
      )}

      <GenerateKeyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}
