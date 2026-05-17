import { cn } from '@/frontend/lib/utils';
import {
  isPermissionMode,
  PERMISSION_MODES,
  type PermissionMode,
} from '@/permissionMode';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

const LABELS: Record<PermissionMode, string> = {
  default: 'Ask',
  'safe-auto': 'Safe auto',
  bypass: 'Bypass',
};

const DESCRIPTIONS: Record<PermissionMode, string> = {
  default: 'Prompt for every tool use',
  'safe-auto': 'Auto-approve known-safe ops, prompt for the rest',
  bypass: 'Auto-approve everything',
};

interface PermissionModePickerProps {
  /** Currently selected permission mode. */
  value: PermissionMode;
  /** Called when the user picks a different mode. */
  onChange: (mode: PermissionMode) => void;
  /** Disable interaction (e.g. while a launch is in flight). */
  disabled?: boolean;
  /** Extra Tailwind classes for the trigger. */
  className?: string;
}

/**
 * Compact thread-level permission-mode picker rendered on the launch surface
 * alongside `ProviderModelPicker` and `EffortPicker`.
 *
 * Values are identical across providers — both managers accept
 * `'default' | 'safe-auto' | 'bypass'` — so the same picker works for Claude
 * and Codex sessions without provider-specific branching.
 */
export default function PermissionModePicker({
  value,
  onChange,
  disabled,
  className,
}: PermissionModePickerProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (isPermissionMode(next)) onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger
        size="sm"
        aria-label="Permission mode"
        title={DESCRIPTIONS[value]}
        // Mirror ProviderModelPicker so the three launch-row pickers share
        // one visual style. See EffortPicker for the same overrides.
        className={cn(
          '!h-auto gap-1.5 rounded border-input bg-background px-2 py-1 text-xs font-medium leading-4 text-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-input focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3 [&_svg]:text-muted-foreground [&_svg]:opacity-100',
          className,
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_MODES.map((mode) => (
          <SelectItem
            key={mode}
            value={mode}
            className="text-xs"
            title={DESCRIPTIONS[mode]}
          >
            {LABELS[mode]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
