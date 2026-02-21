import { useEffect } from 'react';
import { useAppStore } from '@/frontend/stores/app';

/**
 * Syncs the active theme from Zustand to the `data-theme` attribute on `<html>`.
 * Call once at the app root.
 */
export function useTheme() {
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
}
