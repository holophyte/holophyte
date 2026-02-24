/**
 * Tests for dateUtils — focuses on formatTimeAgo which powers the session
 * dropdown "last activity" display in the session-rethink UI.
 */
import { describe, expect, it, vi } from 'vitest';
import { formatTimeAgo } from './dateUtils';

describe('formatTimeAgo', () => {
  it('returns "just now" for timestamps less than 60 seconds ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now)).toBe('just now');
    expect(formatTimeAgo(now - 30_000)).toBe('just now');
    expect(formatTimeAgo(now - 59_000)).toBe('just now');
  });

  it('returns minutes for timestamps 1-59 minutes ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 60_000)).toBe('1m ago');
    expect(formatTimeAgo(now - 5 * 60_000)).toBe('5m ago');
    expect(formatTimeAgo(now - 59 * 60_000)).toBe('59m ago');
  });

  it('returns hours for timestamps 1-23 hours ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 60 * 60_000)).toBe('1h ago');
    expect(formatTimeAgo(now - 3 * 60 * 60_000)).toBe('3h ago');
    expect(formatTimeAgo(now - 23 * 60 * 60_000)).toBe('23h ago');
  });

  it('returns days for timestamps 24+ hours ago', () => {
    const now = Date.now();
    expect(formatTimeAgo(now - 24 * 60 * 60_000)).toBe('1d ago');
    expect(formatTimeAgo(now - 48 * 60 * 60_000)).toBe('2d ago');
    expect(formatTimeAgo(now - 7 * 24 * 60 * 60_000)).toBe('7d ago');
  });

  it('uses mocked Date.now for deterministic results', () => {
    const fixedNow = 1_700_000_000_000;
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);

    expect(formatTimeAgo(fixedNow - 90_000)).toBe('1m ago');
    expect(formatTimeAgo(fixedNow - 2 * 60 * 60_000)).toBe('2h ago');
    expect(formatTimeAgo(fixedNow - 3 * 24 * 60 * 60_000)).toBe('3d ago');

    vi.restoreAllMocks();
  });
});
