import { DEFAULT_MODEL } from '@/constants';

/**
 * Available Claude models in display order (most capable → fastest).
 * Each entry has a stable `id` (the API model string), a short `label` for
 * the UI, and a one-line `description` of the capability/speed tradeoff.
 *
 * Claude has no live `model/list` RPC, so this list is hardcoded.
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

export { DEFAULT_MODEL };
