import { useCallback, useState } from 'react';
import {
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  STORAGE_LAST_EFFORT_PREFIX,
  STORAGE_LAST_MODEL_PREFIX,
  STORAGE_LAST_PERMISSION_PREFIX,
  STORAGE_LAST_PROVIDER,
} from '@/constants';
import {
  defaultPermissionModeFor,
  isPermissionMode,
  type PermissionMode,
} from '@/permissionMode';

export type Provider = 'claude' | 'codex';

export interface LaunchDefaults {
  provider: Provider;
  model: string;
  effort: string;
  permissionMode: PermissionMode;
}

const PROVIDER_DEFAULTS: Record<Provider, { model: string; effort: string }> = {
  claude: { model: DEFAULT_MODEL, effort: DEFAULT_CLAUDE_EFFORT },
  codex: { model: DEFAULT_CODEX_MODEL, effort: DEFAULT_CODEX_EFFORT },
};

function readProvider(): Provider {
  if (typeof window === 'undefined') return DEFAULT_PROVIDER;
  const raw = window.localStorage.getItem(STORAGE_LAST_PROVIDER);
  return raw === 'codex' || raw === 'claude' ? raw : DEFAULT_PROVIDER;
}

function readForProvider(provider: Provider): {
  model: string;
  effort: string;
  permissionMode: PermissionMode;
} {
  const fallback = PROVIDER_DEFAULTS[provider];
  const defaultPermission = defaultPermissionModeFor(provider);
  if (typeof window === 'undefined') {
    return { ...fallback, permissionMode: defaultPermission };
  }
  const model =
    window.localStorage.getItem(STORAGE_LAST_MODEL_PREFIX + provider) ??
    fallback.model;
  const effort =
    window.localStorage.getItem(STORAGE_LAST_EFFORT_PREFIX + provider) ??
    fallback.effort;
  const storedPermission = window.localStorage.getItem(
    STORAGE_LAST_PERMISSION_PREFIX + provider,
  );
  const permissionMode = isPermissionMode(storedPermission)
    ? storedPermission
    : defaultPermission;
  return { model, effort, permissionMode };
}

function loadInitial(): LaunchDefaults {
  const provider = readProvider();
  return { provider, ...readForProvider(provider) };
}

/**
 * Resolve the permission mode to display when switching to `provider` — prefers
 * the last-used value in localStorage, falling back to the provider default.
 */
export function resolvePermissionModeFor(provider: Provider): PermissionMode {
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(
      STORAGE_LAST_PERMISSION_PREFIX + provider,
    );
    if (isPermissionMode(stored)) return stored;
  }
  return defaultPermissionModeFor(provider);
}

/**
 * Persistent last-used `{provider, model, effort, permissionMode}` across task
 * switches and page reloads via `localStorage`.
 *
 * - On mount, reads `STORAGE_LAST_PROVIDER` then the provider-scoped model,
 *   effort, and permission keys. Falls back to `DEFAULT_PROVIDER` and the
 *   matching per-provider defaults from `src/constants.ts` /
 *   {@link defaultPermissionModeFor}.
 * - `save({provider, model, effort, permissionMode})` writes all four keys
 *   synchronously and updates the in-memory snapshot so subsequent reads stay
 *   consistent.
 */
export function useLaunchDefaults() {
  const [defaults, setDefaults] = useState<LaunchDefaults>(loadInitial);

  const save = useCallback((next: LaunchDefaults) => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(STORAGE_LAST_PROVIDER, next.provider);
        window.localStorage.setItem(
          STORAGE_LAST_MODEL_PREFIX + next.provider,
          next.model,
        );
        window.localStorage.setItem(
          STORAGE_LAST_EFFORT_PREFIX + next.provider,
          next.effort,
        );
        window.localStorage.setItem(
          STORAGE_LAST_PERMISSION_PREFIX + next.provider,
          next.permissionMode,
        );
      } catch {
        // Swallow storage failures (private mode, quota) — picker still works.
      }
    }
    setDefaults(next);
  }, []);

  return { defaults, save };
}
