// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/frontend/stores/app';
import { useTheme } from './useTheme';

let mediaMatches = false;
const listeners = new Set<(event: MediaQueryListEvent) => void>();

beforeEach(() => {
  localStorage.clear();
  listeners.clear();
  mediaMatches = false;
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mediaMatches,
    media: query,
    onchange: null,
    addEventListener: (
      event: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      if (event === 'change') listeners.add(listener);
    },
    removeEventListener: (
      event: string,
      listener: (event: MediaQueryListEvent) => void,
    ) => {
      if (event === 'change') listeners.delete(listener);
    },
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  useAppStore.setState({ theme: 'system' });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

function emitSystemThemeChange(matches: boolean) {
  mediaMatches = matches;
  const event = { matches } as MediaQueryListEvent;
  for (const listener of listeners) listener(event);
}

describe('useTheme', () => {
  it('resolves system preference and updates when the OS theme changes', () => {
    const { result } = renderHook(() => useTheme());

    expect(result.current).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');

    act(() => emitSystemThemeChange(true));

    expect(result.current).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('uses explicit user theme instead of system preference', () => {
    mediaMatches = true;
    useAppStore.setState({ theme: 'light' });

    const { result } = renderHook(() => useTheme());

    expect(result.current).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
