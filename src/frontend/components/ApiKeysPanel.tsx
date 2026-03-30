import { api } from '@convex/_generated/api';
import type { Doc } from '@convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import {
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  TriangleAlert,
} from 'lucide-react';
import { useMemo, useState } from 'react';
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
  const [keyVisible, setKeyVisible] = useState(false);

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
    try {
      await navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable (e.g. non-HTTPS context)
    }
  };

  const handleClose = () => {
    setName('');
    setMcpScope(true);
    setSubmitting(false);
    setError(null);
    setGeneratedKey(null);
    setCopied(false);
    setKeyVisible(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        {generatedKey ? (
          <>
            <DialogHeader>
              <DialogTitle>API Key Generated</DialogTitle>
              <DialogDescription>
                Copy this key now — it won't be shown again.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
                <p>
                  Store this key securely. You won't be able to view it again
                  after closing this dialog.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-3 py-3">
                <code className="flex-1 truncate font-mono text-xs select-all text-foreground/90">
                  {keyVisible ? generatedKey : `holo_${'•'.repeat(24)}`}
                </code>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => setKeyVisible((v) => !v)}
                  title={keyVisible ? 'Hide key' : 'Show key'}
                >
                  {keyVisible ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
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
        'grid grid-cols-[1fr_5rem_7rem_6rem_5.5rem] items-center gap-x-4 gap-y-0 px-4 py-3 text-sm transition-colors hover:bg-muted/30',
        isRevoked && 'opacity-50',
      )}
    >
      <span className="truncate font-medium">{apiKey.name}</span>
      <div className="flex items-center gap-1">
        {apiKey.scopes.map((scope) => (
          <Badge
            key={scope}
            variant="secondary"
            className="rounded-full px-2 py-0 text-[11px] font-medium"
          >
            {scope}
          </Badge>
        ))}
      </div>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDate(apiKey._creationTime)}
      </span>
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {apiKey.lastUsedAt !== undefined ? formatDate(apiKey.lastUsedAt) : '—'}
      </span>
      <div>
        {!isRevoked ? (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5"
            onClick={() => onRevoke(apiKey._id)}
            disabled={revoking}
          >
            {revoking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Revoke'
            )}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {apiKey.revokedAt !== undefined ? formatDate(apiKey.revokedAt) : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function KeyTableHeader() {
  return (
    <div className="grid grid-cols-[1fr_5rem_7rem_6rem_5.5rem] items-center gap-x-4 border-b px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <span>Name</span>
      <span>Scopes</span>
      <span>Created</span>
      <span>Last used</span>
      <span>Action</span>
    </div>
  );
}

interface KeysListProps {
  keys: ApiKeyDoc[] | undefined;
  onRevoke: (keyId: ApiKeyDoc['_id']) => void;
  revokingId: ApiKeyDoc['_id'] | null;
  onGenerate: () => void;
}

function KeysList({ keys, onRevoke, revokingId, onGenerate }: KeysListProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  const { active, revoked } = useMemo(() => {
    if (!keys) return { active: [], revoked: [] };
    return {
      active: keys.filter((k) => k.revokedAt === undefined),
      revoked: keys.filter((k) => k.revokedAt !== undefined),
    };
  }, [keys]);

  if (keys === undefined) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (keys.length === 0) {
    return (
      <div className="rounded-md border border-dashed p-8 text-center">
        <KeyRound className="mx-auto h-8 w-8 text-muted-foreground/50" />
        <p className="mt-2 text-sm text-muted-foreground">
          No API keys yet. Generate one to get started.
        </p>
        <Button size="sm" className="mt-4" onClick={onGenerate}>
          <KeyRound className="h-4 w-4" />
          Generate Key
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <KeyTableHeader />
        <div className="divide-y">
          {active.map((key) => (
            <KeyRow
              key={key._id}
              apiKey={key}
              onRevoke={onRevoke}
              revoking={revokingId === key._id}
            />
          ))}
          <div className="flex justify-end border-t px-4 py-3">
            <Button size="sm" onClick={onGenerate}>
              <KeyRound className="h-4 w-4" />
              Generate Key
            </Button>
          </div>
        </div>
      </div>
      {revoked.length > 0 && (
        <div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground cursor-pointer"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 transition-transform',
                !historyOpen && '-rotate-90',
              )}
            />
            <span>Revoked keys</span>
            <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0 text-[11px] font-medium tabular-nums">
              {revoked.length}
            </span>
          </button>
          {historyOpen && (
            <div className="mt-2 rounded-md border">
              <div className="divide-y">
                {revoked.map((key) => (
                  <KeyRow
                    key={key._id}
                    apiKey={key}
                    onRevoke={onRevoke}
                    revoking={revokingId === key._id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
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
      <div>
        <h2 className="text-base font-semibold">API Keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage keys for authenticating external tools and MCP servers.
        </p>
      </div>

      <KeysList
        keys={keys}
        onRevoke={handleRevoke}
        revokingId={revokingId}
        onGenerate={() => setDialogOpen(true)}
      />

      <GenerateKeyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}
