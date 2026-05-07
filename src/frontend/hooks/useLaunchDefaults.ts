import { useCallback, useState } from 'react';
import {
  DEFAULT_CLAUDE_EFFORT,
  DEFAULT_CODEX_EFFORT,
  DEFAULT_CODEX_MODEL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  STORAGE_LAST_EFFORT_PREFIX,
  STORAGE_LAST_MODEL_PREFIX,
  STORAGE_LAST_PROVIDER,
} from '@/constants';

export type Provider = 'claude' | 'codex';

export interface LaunchDefaults {
  provider: Provider;
  model: string;
  effort: string;
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
} {
  const fallback = PROVIDER_DEFAULTS[provider];
  if (typeof window === 'undefined') return fallback;
  const model =
    window.localStorage.getItem(STORAGE_LAST_MODEL_PREFIX + provider) ??
    fallback.model;
  const effort =
    window.localStorage.getItem(STORAGE_LAST_EFFORT_PREFIX + provider) ??
    fallback.effort;
  return { model, effort };
}

function loadInitial(): LaunchDefaults {
  const provider = readProvider();
  const { model, effort } = readForProvider(provider);
  return { provider, model, effort };
}

/**
 * Persistent last-used `{provider, model, effort}` across task switches and
 * page reloads via `localStorage`.
 *
 * - On mount, reads `STORAGE_LAST_PROVIDER` then the provider-scoped model
 *   and effort keys. Falls back to `DEFAULT_PROVIDER` and the matching
 *   per-provider defaults from `src/constants.ts`.
 * - `save({provider, model, effort})` writes all three keys synchronously and
 *   updates the in-memory snapshot so subsequent reads stay consistent.
 *
 * @example
 * ```tsx
 * const { defaults, save } = useLaunchDefaults();
 * const [pick, setPick] = useState(defaults);
 * // before launching:
 * save(pick);
 * await createSession({ ... });
 * ```
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
      } catch {
        // Swallow storage failures (private mode, quota) — picker still works.
      }
    }
    setDefaults(next);
  }, []);

  return { defaults, save };
}
