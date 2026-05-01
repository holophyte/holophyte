import {
  CLAUDE_EFFORTS,
  CODEX_EFFORTS,
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CODEX_EFFORT,
} from '@/constants';
import { cn } from '@/frontend/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

export type Provider = 'claude' | 'codex';

/**
 * Default effort value for a provider — used by callers that need a fallback
 * when no last-used value is present in localStorage.
 */
export function defaultEffortFor(provider: Provider): string {
  return provider === 'codex' ? DEFAULT_CODEX_EFFORT : DEFAULT_CLAUDE_EFFORT;
}

/** All effort options for a provider, in display order. */
export function effortsFor(provider: Provider): readonly string[] {
  return provider === 'codex' ? CODEX_EFFORTS : CLAUDE_EFFORTS;
}

const LABEL: Record<string, string> = {
  auto: 'Auto',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

interface EffortPickerProps {
  /** Provider determines which option set is shown. */
  provider: Provider;
  /** Currently selected effort value. */
  value: string;
  /** Called when the user picks a different effort. */
  onChange: (effort: string) => void;
  /** Extra Tailwind classes for the trigger. */
  className?: string;
}

/**
 * Compact reasoning-effort picker. Options swap based on `provider`:
 * Claude uses {@link CLAUDE_EFFORTS} (`auto` | `low/medium/high/xhigh/max`),
 * Codex uses {@link CODEX_EFFORTS} (`minimal/low/medium/high`).
 */
export default function EffortPicker({
  provider,
  value,
  onChange,
  className,
}: EffortPickerProps) {
  const options = effortsFor(provider);

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        aria-label="Reasoning effort"
        className={cn('h-7 px-2 text-xs', className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt} value={opt} className="text-xs">
            {LABEL[opt] ?? opt}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
