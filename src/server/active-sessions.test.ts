// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const claudeActive: string[] = [];
const codexActive: string[] = [];

vi.mock('@/claude/manager', () => ({
  getActiveSessions: () => claudeActive.slice(),
}));

vi.mock('@/codex/manager', () => ({
  getActiveSessions: () => codexActive.slice(),
}));

import { getAllActiveSessions } from './active-sessions';

afterEach(() => {
  claudeActive.length = 0;
  codexActive.length = 0;
});

describe('getAllActiveSessions', () => {
  it('returns an empty list when both managers have no sessions', () => {
    expect(getAllActiveSessions()).toEqual([]);
  });

  it('returns claude session IDs when only the claude manager has sessions', () => {
    claudeActive.push('claude-1', 'claude-2');
    expect(getAllActiveSessions()).toEqual(['claude-1', 'claude-2']);
  });

  it('returns codex session IDs when only the codex manager has sessions', () => {
    codexActive.push('codex-1', 'codex-2');
    expect(getAllActiveSessions()).toEqual(['codex-1', 'codex-2']);
  });

  it('concatenates claude IDs followed by codex IDs when both have sessions', () => {
    claudeActive.push('claude-1');
    codexActive.push('codex-1', 'codex-2');
    expect(getAllActiveSessions()).toEqual(['claude-1', 'codex-1', 'codex-2']);
  });

  it('returns a fresh array — mutating the result does not affect either manager', () => {
    claudeActive.push('claude-1');
    codexActive.push('codex-1');
    const ids = getAllActiveSessions();
    ids.push('mutated');
    expect(getAllActiveSessions()).toEqual(['claude-1', 'codex-1']);
  });
});
