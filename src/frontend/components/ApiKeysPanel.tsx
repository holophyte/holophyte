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
  Pencil,
  RefreshCw,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
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
  const d = new Date(timestamp);
  const date = d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${date}, ${time}`;
}

interface GenerateKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const EXPIRY_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'No expiration', days: 0 },
] as const;

function GenerateKeyDialog({ open, onOpenChange }: GenerateKeyDialogProps) {
  const [name, setName] = useState('');
  const [mcpScope, setMcpScope] = useState(true);
  const [expiryDays, setExpiryDays] = useState(90);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);
  // Track whether the dialog is open so in-flight generate() calls don't set
  // state after the dialog has been closed (stale key shown on next open).
  const isOpenRef = useRef(open);
  isOpenRef.current = open;

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
      const expiresAt =
        expiryDays > 0
          ? Date.now() + expiryDays * 24 * 60 * 60 * 1000
          : undefined;
      const rawKey = await generate({
        name: name.trim(),
        scopes,
        expiresAt,
      });
      // Guard against the dialog being closed while generate() was in-flight.
      // Without this check, setGeneratedKey would overwrite the null set by
      // handleClose and show the stale key next time the dialog opens.
      if (isOpenRef.current) {
        setGeneratedKey(rawKey);
      }
    } catch (err) {
      if (isOpenRef.current) {
        const message =
          err instanceof Error ? err.message : 'Failed to generate key.';
        setError(message);
      }
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
    setExpiryDays(90);
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
                  aria-label={keyVisible ? 'Hide key' : 'Show key'}
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
                  aria-label="Copy to clipboard"
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
              <div className="space-y-2">
                <Label htmlFor="key-expiry">Expiration</Label>
                <select
                  id="key-expiry"
                  value={expiryDays}
                  onChange={(e) => setExpiryDays(Number(e.target.value))}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {EXPIRY_OPTIONS.map((opt) => (
                    <option key={opt.days} value={opt.days}>
                      {opt.label}
                    </option>
                  ))}
                </select>
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

interface EditKeyDialogProps {
  apiKey: ApiKeyDoc;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function EditKeyDialog({ apiKey, open, onOpenChange }: EditKeyDialogProps) {
  const [name, setName] = useState(apiKey.name);
  const [mcpScope, setMcpScope] = useState(apiKey.scopes.includes('mcp'));
  const [saving, setSaving] = useState(false);
  const update = useMutation(api.apiKeys.update);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const scopes = mcpScope ? ['mcp'] : [];
    if (scopes.length === 0) return;

    setSaving(true);
    try {
      await update({ keyId: apiKey._id, name: trimmed, scopes });
      onOpenChange(false);
    } catch (err) {
      console.error('Failed to update API key:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Edit API Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-key-name">Name</Label>
              <Input
                id="edit-key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
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
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !mcpScope || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegeneratedKeyDialog({
  rawKey,
  onClose,
}: {
  rawKey: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [keyVisible, setKeyVisible] = useState(false);

  const handleCopy = async () => {
    if (!rawKey) return;
    try {
      await navigator.clipboard.writeText(rawKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const handleClose = () => {
    setCopied(false);
    setKeyVisible(false);
    onClose();
  };

  return (
    <Dialog open={rawKey !== null} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Key Regenerated</DialogTitle>
          <DialogDescription>
            Your old key has been revoked. Copy the new key now — it won't be
            shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-start gap-2.5 rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
            <p>
              Store this key securely. You won't be able to view it again after
              closing this dialog.
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-md border bg-muted/40 px-3 py-3">
            <code className="flex-1 truncate font-mono text-xs text-foreground/90 select-all">
              {keyVisible ? rawKey : `holo_${'•'.repeat(24)}`}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => setKeyVisible((v) => !v)}
              title={keyVisible ? 'Hide key' : 'Show key'}
              aria-label={keyVisible ? 'Hide key' : 'Show key'}
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
              aria-label="Copy to clipboard"
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
  const [editOpen, setEditOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [regeneratedKey, setRegeneratedKey] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const regenerate = useAction(api.apiKeys.regenerate);

  const handleRevoke = () => {
    onRevoke(apiKey._id);
    setConfirmRevoke(false);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const rawKey = await regenerate({ keyId: apiKey._id });
      setRegeneratedKey(rawKey);
    } catch (err) {
      console.error('Failed to regenerate API key:', err);
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'grid h-12 grid-cols-[minmax(8rem,1fr)_3.5rem_10rem_10rem_10rem_6rem] items-center gap-x-4 px-4 text-sm transition-colors hover:bg-muted/30',
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
          {apiKey.lastUsedAt !== undefined
            ? formatDate(apiKey.lastUsedAt)
            : '—'}
        </span>
        <span
          className={cn(
            'text-xs whitespace-nowrap',
            apiKey.expiresAt !== undefined && apiKey.expiresAt < Date.now()
              ? 'text-destructive'
              : 'text-muted-foreground',
          )}
        >
          {apiKey.expiresAt !== undefined
            ? apiKey.expiresAt < Date.now()
              ? 'Expired'
              : formatDate(apiKey.expiresAt)
            : 'Never'}
        </span>
        <div className="flex h-8 items-center justify-end gap-1.5">
          {!isRevoked ? (
            confirmRevoke ? (
              <div className="flex items-center gap-2 pl-2">
                <span className="text-xs text-destructive whitespace-nowrap">
                  Revoke?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs text-destructive border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                  onClick={handleRevoke}
                  disabled={revoking}
                >
                  {revoking ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Yes'
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setConfirmRevoke(false)}
                >
                  No
                </Button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="p-1 text-muted-foreground hover:text-ring transition-colors cursor-pointer rounded"
                  onClick={() => setEditOpen(true)}
                  title="Edit"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className={cn(
                    'p-1 text-muted-foreground hover:text-ring transition-colors cursor-pointer rounded',
                    regenerating && 'animate-spin',
                  )}
                  onClick={handleRegenerate}
                  disabled={regenerating}
                  title="Regenerate key"
                  aria-label="Regenerate key"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors cursor-pointer rounded"
                  onClick={() => setConfirmRevoke(true)}
                  title="Revoke"
                  aria-label="Revoke"
                >
                  <span className="relative flex h-4.5 w-4.5 items-center justify-center rounded-full bg-current opacity-80">
                    <X className="h-3 w-3 text-background" strokeWidth={3} />
                  </span>
                </button>
              </>
            )
          ) : (
            <span className="text-xs text-muted-foreground">
              {apiKey.revokedAt !== undefined
                ? formatDate(apiKey.revokedAt)
                : ''}
            </span>
          )}
        </div>
      </div>
      {editOpen && (
        <EditKeyDialog
          apiKey={apiKey}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <RegeneratedKeyDialog
        rawKey={regeneratedKey}
        onClose={() => setRegeneratedKey(null)}
      />
    </>
  );
}

function KeyTableHeader({ revoked = false }: { revoked?: boolean }) {
  return (
    <div className="grid grid-cols-[minmax(8rem,1fr)_3.5rem_10rem_10rem_10rem_6rem] items-center gap-x-4 border-b px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      <span>Name</span>
      <span>Scopes</span>
      <span>Created</span>
      <span>Last used</span>
      <span>Expires</span>
      <span>{revoked ? 'Revoked' : ''}</span>
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
        </div>
      </div>
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={onGenerate}>
          <KeyRound className="h-4 w-4" />
          Generate Key
        </Button>
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
              <KeyTableHeader revoked />
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
    } catch (err) {
      console.error('Failed to revoke API key:', err);
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
