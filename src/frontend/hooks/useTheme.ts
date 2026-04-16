import { useEffect, useSyncExternalStore } from 'react';
import type { ThemeName, ThemePreference } from '@/frontend/stores/app';
import { useAppStore } from '@/frontend/stores/app';

const DARK_SCHEME_QUERY = '(prefers-color-scheme: dark)';

function getSystemTheme(): ThemeName {
  if (
    typeof window !== 'undefined' &&
    'matchMedia' in window &&
    window.matchMedia(DARK_SCHEME_QUERY).matches
  ) {
    return 'dark';
  }
  return 'light';
}

function subscribeToSystemThemeChange(onStoreChange: () => void) {
  if (!('matchMedia' in window)) return () => {};
  const mediaQuery = window.matchMedia(DARK_SCHEME_QUERY);
  mediaQuery.addEventListener('change', onStoreChange);
  return () => mediaQuery.removeEventListener('change', onStoreChange);
}

function getServerSnapshot(): ThemeName {
  return 'light';
}

export function resolveTheme(theme: ThemePreference, systemTheme: ThemeName) {
  return theme === 'system' ? systemTheme : theme;
}

/**
 * Syncs the resolved theme to the `data-theme` attribute on `<html>`.
 * Call once at the app root.
 */
export function useTheme() {
  const theme = useAppStore((s) => s.theme);
  const systemTheme = useSyncExternalStore(
    subscribeToSystemThemeChange,
    getSystemTheme,
    getServerSnapshot,
  );
  const resolvedTheme = resolveTheme(theme, systemTheme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme);
  }, [resolvedTheme]);

  return resolvedTheme;
}
