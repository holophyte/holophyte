// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { defaultPermissionModeFor, isPermissionMode } from './permissionMode';

describe('isPermissionMode', () => {
  it.each(['default', 'safe-auto', 'bypass'])('accepts %s', (mode) => {
    expect(isPermissionMode(mode)).toBe(true);
  });

  it.each([null, undefined, '', 'bypass ', 'BYPASS', 'unknown', 42])(
    'rejects %p',
    (value) => {
      expect(isPermissionMode(value)).toBe(false);
    },
  );
});

describe('defaultPermissionModeFor', () => {
  // Pinned defaults: changing these silently regresses launch UX (Codex →
  // one-click bypass; Claude → safe-auto with prompts for risky ops) and
  // shifts the legacy/MCP fallback path in `src/server/subscriptions.ts`.
  it('defaults Codex to bypass', () => {
    expect(defaultPermissionModeFor('codex')).toBe('bypass');
  });

  it('defaults Claude to safe-auto', () => {
    expect(defaultPermissionModeFor('claude')).toBe('safe-auto');
  });
});
