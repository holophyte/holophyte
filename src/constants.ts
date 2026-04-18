/** Default Claude model used when launching a new session. */
export const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * UI-only default provider. Consumed by `useLaunchDefaults` as the fallback
 * when localStorage is empty (first launch, cleared storage). Has NO effect on
 * the backend: `sessions.create` requires `provider` explicitly.
 */
export const DEFAULT_PROVIDER: 'claude' | 'codex' = 'claude';

/** Default Codex model — fallback when provider is 'codex' and no model is specified. */
export const DEFAULT_CODEX_MODEL = 'gpt-5.4-mini';

/** Fallback Codex model list if the live `model/list` RPC fails. Seven models matching the current `codex` CLI `/model` picker. */
export const CODEX_MODELS_FALLBACK = [
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    description: 'Latest frontier agentic coding model',
  },
  {
    id: 'gpt-5.2-codex',
    label: 'GPT-5.2 Codex',
    description: 'Frontier agentic coding model',
  },
  {
    id: 'gpt-5.1-codex-max',
    label: 'GPT-5.1 Codex Max',
    description: 'Codex-optimized flagship for deep and fast reasoning',
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    description: 'Smaller frontier agentic coding model',
  },
  {
    id: 'gpt-5.3-codex',
    label: 'GPT-5.3 Codex',
    description: 'Frontier Codex-optimized agentic coding model',
  },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    description: 'Optimized for long-running agent work',
  },
  {
    id: 'gpt-5.1-codex-mini',
    label: 'GPT-5.1 Codex Mini',
    description: 'Optimized for Codex. Cheaper, faster, less capable',
  },
] as const;

export const CODEX_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

/**
 * Claude effort picker values. `'auto'` = omit `effort` / `effortLevel`, let
 * adaptive thinking drive (matches Claude Code CLI `/effort auto`). `'max'`
 * omitted — start-only per SDK `Settings.effortLevel`. `'xhigh'` (Opus 4.7)
 * not yet in `@anthropic-ai/claude-agent-sdk@0.2.112`; add when the SDK
 * exposes it.
 */
export const CLAUDE_EFFORTS = ['auto', 'low', 'medium', 'high'] as const;

export const DEFAULT_CODEX_EFFORT: (typeof CODEX_EFFORTS)[number] = 'medium';
export const DEFAULT_CLAUDE_EFFORT: (typeof CLAUDE_EFFORTS)[number] = 'auto';

/** localStorage keys for last-used-defaults persistence. */
export const STORAGE_LAST_PROVIDER = 'holophyte.lastProvider';
export const STORAGE_LAST_MODEL_PREFIX = 'holophyte.lastModel.'; // e.g. `holophyte.lastModel.codex`
export const STORAGE_LAST_EFFORT_PREFIX = 'holophyte.lastEffort.'; // e.g. `holophyte.lastEffort.codex`

/**
 * How long a session may remain in `queued` status before the Convex cron
 * reaps it as `failed`. 10 minutes gives ample time for the companion to come
 * online, but prevents orphaned sessions from accumulating indefinitely.
 */
export const QUEUED_SESSION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * How long a queued session must wait before the frontend shows a warning
 * banner. Keeps the UI quiet for the first 30 seconds (companion is usually
 * online within one or two poll cycles).
 */
export const QUEUED_WARNING_THRESHOLD_MS = 30 * 1000; // 30 seconds

/**
 * Dev/test user credentials — shared between `AutoTestAuth`, `seed-dev-user.sh`,
 * and E2E global setup. Only functional when `ALLOW_PASSWORD_AUTH=1` is set on
 * the Convex backend (local dev and E2E only, never production).
 */
export const DEV_USER_EMAIL = 'dev@holophyte.test';
export const DEV_USER_PASSWORD = 'password';
