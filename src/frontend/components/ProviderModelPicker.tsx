import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CODEX_MODELS_FALLBACK } from '@/constants';
import { cn } from '@/frontend/lib/utils';
import { CLAUDE_MODELS } from './launchModels';

export type Provider = 'claude' | 'codex';

export interface ProviderModelValue {
  provider: Provider;
  model: string;
}

interface ProviderModelPickerProps {
  value: ProviderModelValue;
  onChange: (next: ProviderModelValue) => void;
  className?: string;
  disabled?: boolean;
}

interface ModelEntry {
  id: string;
  label: string;
  description: string;
}

const COMING_SOON: ReadonlyArray<{ id: Provider | string; label: string }> = [
  { id: 'cursor', label: 'Cursor' },
  { id: 'opencode', label: 'OpenCode' },
  { id: 'gemini', label: 'Gemini' },
];

/**
 * Two-level grouped model picker matching the T3 Code pattern.
 *
 * Active groups:
 *   - **Codex** — entries from `api.codexModels.get` (live cache from the
 *     companion's `model/list` probe), falling back to `CODEX_MODELS_FALLBACK`
 *     when the cache is empty or the query is still loading.
 *   - **Claude** — hardcoded {@link CLAUDE_MODELS}.
 *
 * Disabled groups (visible but not clickable): Cursor, OpenCode, Gemini.
 */
export default function ProviderModelPicker({
  value,
  onChange,
  className,
  disabled,
}: ProviderModelPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const codexCache = useQuery(api.codexModels.get);

  const codexModels: readonly ModelEntry[] =
    codexCache && codexCache.models.length > 0
      ? codexCache.models
      : CODEX_MODELS_FALLBACK;

  const allModels: ReadonlyArray<{ provider: Provider; entry: ModelEntry }> = [
    ...codexModels.map((m) => ({ provider: 'codex' as const, entry: m })),
    ...CLAUDE_MODELS.map((m) => ({ provider: 'claude' as const, entry: m })),
  ];

  const exactMatch = allModels.find(
    (m) => m.provider === value.provider && m.entry.id === value.model,
  );
  // If the stored model isn't in the current option set (e.g. a Codex model
  // that disappeared from the live cache, or a stale localStorage value from
  // an older release), display the first model in the same provider group as
  // a fallback and notify the parent so submissions don't carry a phantom ID.
  const providerFallback = allModels.find((m) => m.provider === value.provider);
  const selected = exactMatch ?? providerFallback ?? allModels[0];

  // Use stable scalar deps for the self-heal effect — `selected` is a fresh
  // object reference on every render (`.find()` result) and parents may pass
  // an inline `onChange`, so depending on those would re-fire the effect on
  // every parent render until the value stabilises.
  const healProvider = !exactMatch && selected ? selected.provider : null;
  const healModel = !exactMatch && selected ? selected.entry.id : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: parents commonly pass an inline onChange; including it would re-fire the heal on every parent render. Scalar healProvider/healModel are the real triggers.
  useEffect(() => {
    if (!healProvider || !healModel) return;
    onChange({ provider: healProvider, model: healModel });
  }, [healProvider, healModel]);

  const selectedLabel = selected
    ? `${selected.provider === 'codex' ? 'Codex' : 'Claude'} · ${selected.entry.label}`
    : 'Select a model';

  const handlePick = (provider: Provider, model: string) => {
    onChange({ provider, model });
    setOpen(false);
  };

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-input bg-background px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-medium">{selectedLabel}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute bottom-full left-0 z-50 mb-1 max-h-[60vh] min-w-[260px] overflow-y-auto rounded-md border bg-popover py-1 shadow-md"
          >
            <Group label="Codex">
              {codexModels.map((m) => (
                <ModelRow
                  key={`codex-${m.id}`}
                  entry={m}
                  selected={value.provider === 'codex' && value.model === m.id}
                  onClick={() => handlePick('codex', m.id)}
                />
              ))}
            </Group>
            <Group label="Claude">
              {CLAUDE_MODELS.map((m) => (
                <ModelRow
                  key={`claude-${m.id}`}
                  entry={m}
                  selected={value.provider === 'claude' && value.model === m.id}
                  onClick={() => handlePick('claude', m.id)}
                />
              ))}
            </Group>
            <div className="my-1 border-t border-border/50" />
            {COMING_SOON.map((c) => (
              <div
                key={c.id}
                aria-disabled
                className="flex items-center justify-between px-3 py-1.5 text-xs opacity-50"
              >
                <span className="font-medium">{c.label}</span>
                <span className="text-muted-foreground">Coming soon</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-1">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function ModelRow({
  entry,
  selected,
  onClick,
}: {
  entry: ModelEntry;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex w-full flex-col px-3 py-2 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground',
        selected && 'bg-accent/50',
      )}
    >
      <span className="font-medium">{entry.label}</span>
      <span className="mt-0.5 text-muted-foreground">{entry.description}</span>
    </button>
  );
}
