import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolvePermissionModeFor,
  useLaunchDefaults,
} from './useLaunchDefaults';

describe('useLaunchDefaults', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
  });

  it('falls back to per-provider defaults when storage is empty', () => {
    const { result } = renderHook(() => useLaunchDefaults());
    // DEFAULT_PROVIDER is 'claude' → safe-auto
    expect(result.current.defaults.provider).toBe('claude');
    expect(result.current.defaults.permissionMode).toBe('safe-auto');
  });

  it('save() writes provider-scoped permission key to localStorage', () => {
    const { result } = renderHook(() => useLaunchDefaults());
    act(() => {
      result.current.save({
        provider: 'codex',
        model: 'gpt-5.4-mini',
        effort: 'medium',
        permissionMode: 'default',
      });
    });
    expect(window.localStorage.getItem('holophyte.lastPermission.codex')).toBe(
      'default',
    );
    // Claude's slot must be untouched — switching providers should not
    // overwrite the other provider's memory.
    expect(
      window.localStorage.getItem('holophyte.lastPermission.claude'),
    ).toBeNull();
  });

  it('loads provider-scoped permission on mount', () => {
    window.localStorage.setItem('holophyte.lastProvider', 'codex');
    window.localStorage.setItem('holophyte.lastPermission.codex', 'safe-auto');
    const { result } = renderHook(() => useLaunchDefaults());
    expect(result.current.defaults.provider).toBe('codex');
    expect(result.current.defaults.permissionMode).toBe('safe-auto');
  });

  it('ignores garbage in the permission slot and falls back to the default', () => {
    window.localStorage.setItem('holophyte.lastProvider', 'codex');
    window.localStorage.setItem('holophyte.lastPermission.codex', 'not-a-mode');
    const { result } = renderHook(() => useLaunchDefaults());
    expect(result.current.defaults.permissionMode).toBe('bypass');
  });
});

describe('resolvePermissionModeFor', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns Codex default (bypass) when no value is stored', () => {
    expect(resolvePermissionModeFor('codex')).toBe('bypass');
  });

  it('returns Claude default (safe-auto) when no value is stored', () => {
    expect(resolvePermissionModeFor('claude')).toBe('safe-auto');
  });

  it('returns the stored value when valid', () => {
    window.localStorage.setItem('holophyte.lastPermission.claude', 'bypass');
    expect(resolvePermissionModeFor('claude')).toBe('bypass');
  });
});
