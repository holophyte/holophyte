import { ChevronDown } from 'lucide-react';
import { useRef, useState } from 'react';
import { DEFAULT_MODEL } from '@/constants';
import { cn } from '@/frontend/lib/utils';

/**
 * Available Claude models in display order (most capable → fastest).
 * Each entry has a stable `id` (the API model string), a short `label` for
 * the UI, and a one-line `description` of the capability/speed tradeoff.
 */
export const CLAUDE_MODELS = [
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    description: 'Most capable — best for complex tasks',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    description: 'Balanced — capable and fast',
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    label: 'Sonnet 4.5',
    description: 'Previous generation — stable',
  },
  {
    id: 'claude-haiku-4-5-20251001',
    label: 'Haiku 4.5',
    description: 'Fastest — best for quick tasks',
  },
] as const;

/** Union of valid Claude model ID strings derived from {@link CLAUDE_MODELS}. */
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

// Re-export for consumers that import from ModelPicker
export { DEFAULT_MODEL } from '@/constants';

/** Props for {@link ModelPicker}. */
interface ModelPickerProps {
  /** The currently selected model ID. */
  value: ClaudeModelId;
  /** Called when the user selects a different model. */
  onChange: (model: ClaudeModelId) => void;
  /** Extra Tailwind classes applied to the wrapper element. */
  className?: string;
}

/**
 * Compact dropdown for selecting which Claude model to use when launching
 * a session. Shows the selected model label and opens a popover listing all
 * options from {@link CLAUDE_MODELS} with their capability descriptions.
 *
 * Closing the popover via backdrop click is supported.
 *
 * @example
 * ```tsx
 * const [model, setModel] = useState<ClaudeModelId>(DEFAULT_MODEL);
 * <ModelPicker value={model} onChange={setModel} />
 * ```
 */
export default function ModelPicker({
  value,
  onChange,
  className,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected =
    CLAUDE_MODELS.find((m) => m.id === value) ?? CLAUDE_MODELS[2];

  return (
    <div className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded border border-input bg-background text-xs text-foreground hover:bg-accent hover:text-accent-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="font-medium">{selected?.label}</span>
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {open && (
        <>
          {/* Backdrop to close on click outside */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            role="listbox"
            className="absolute bottom-full mb-1 left-0 z-50 min-w-[200px] rounded-md border bg-popover shadow-md py-1"
          >
            {CLAUDE_MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                role="option"
                aria-selected={value === model.id}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                className={cn(
                  'flex flex-col w-full px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors',
                  value === model.id && 'bg-accent/50',
                )}
              >
                <span className="font-medium">{model.label}</span>
                <span className="text-muted-foreground mt-0.5">
                  {model.description}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
