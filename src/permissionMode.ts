/**
 * Shared permission-mode vocabulary used by both Claude and Codex managers
 * and by the frontend picker. Keeping the type + constants in one place
 * prevents the two providers from drifting (e.g. one adding a new mode
 * without the other).
 */

/** A session's auto-approval policy for tool use. */
export type PermissionMode = 'default' | 'safe-auto' | 'bypass';

/** All permission modes in display order, ordered strict → permissive. */
export const PERMISSION_MODES: readonly PermissionMode[] = [
  'default',
  'safe-auto',
  'bypass',
] as const;

const PERMISSION_MODE_SET = new Set<PermissionMode>(PERMISSION_MODES);

/** Narrowing predicate that accepts any string. */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    typeof value === 'string' &&
    PERMISSION_MODE_SET.has(value as PermissionMode)
  );
}

/** Per-provider default. Codex preserves its Phase-0 one-click UX. */
export function defaultPermissionModeFor(
  provider: 'claude' | 'codex',
): PermissionMode {
  return provider === 'codex' ? 'bypass' : 'safe-auto';
}
