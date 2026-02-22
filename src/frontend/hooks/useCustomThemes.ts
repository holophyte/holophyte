import { api } from '@convex/_generated/api';
import { useMutation, useQuery } from 'convex/react';
import { useEffect, useRef } from 'react';
import type { CustomTheme } from '@/frontend/lib/theme';
import { generateThemeCSS } from '@/frontend/lib/theme';

const CACHE_KEY = 'holophyte-custom-themes';
const STYLE_ID = 'custom-themes';

interface CachedTheme {
  id: string;
  name: string;
  colorScheme: 'light' | 'dark';
  background: string;
  foreground: string;
  primary: string;
  accent: string;
  ring: string;
  overrides?: string;
  css: string;
}

/** Default foreground/accent for docs missing new fields (e.g. stale cache). */
function defaultForeground(bg: string, colorScheme: string) {
  const parts = bg.split(/\s+/);
  const c = parts[1] ?? '0.02';
  const h = parts[2] ?? '0';
  return colorScheme === 'dark' ? `0.93 ${c} ${h}` : `0.2 ${c} ${h}`;
}

function defaultAccent(bg: string, colorScheme: string) {
  const l = parseFloat(bg.split(/\s+/)[0] ?? '0.5');
  const c = parseFloat(bg.split(/\s+/)[1] ?? '0.02');
  const h = bg.split(/\s+/)[2] ?? '0';
  const offset = colorScheme === 'dark' ? 0.14 : -0.14;
  return `${(l + offset).toFixed(4)} ${(c + 0.01).toFixed(4)} ${h}`;
}

function docToCustomTheme(doc: {
  _id: string;
  name: string;
  colorScheme: 'light' | 'dark';
  background: string;
  foreground?: string;
  primary: string;
  accent?: string;
  ring: string;
  overrides?: string;
}): CustomTheme {
  return {
    id: doc._id,
    name: doc.name,
    colorScheme: doc.colorScheme,
    background: doc.background,
    foreground:
      doc.foreground ?? defaultForeground(doc.background, doc.colorScheme),
    primary: doc.primary,
    accent: doc.accent ?? defaultAccent(doc.background, doc.colorScheme),
    ring: doc.ring,
    overrides: doc.overrides ? JSON.parse(doc.overrides) : undefined,
  };
}

function injectStyles(themes: CustomTheme[]) {
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = themes.map(generateThemeCSS).join('\n');
}

function writeCache(themes: CustomTheme[]) {
  const cached: CachedTheme[] = themes.map((t) => ({
    id: t.id,
    name: t.name,
    colorScheme: t.colorScheme,
    background: t.background,
    foreground: t.foreground,
    primary: t.primary,
    accent: t.accent,
    ring: t.ring,
    overrides: t.overrides ? JSON.stringify(t.overrides) : undefined,
    css: generateThemeCSS(t),
  }));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
  } catch {
    // localStorage full — ignore
  }
}

export function useCustomThemes() {
  const docs = useQuery(api.customThemes.list);
  const prevRef = useRef<string>('');

  useEffect(() => {
    if (!docs) return;

    const themes = docs.map(docToCustomTheme);
    const key = JSON.stringify(
      docs.map(
        (d) =>
          d._id +
          d.name +
          d.background +
          d.foreground +
          d.primary +
          d.accent +
          d.ring +
          (d.overrides ?? ''),
      ),
    );

    // Only update DOM + cache when data actually changed
    if (key !== prevRef.current) {
      prevRef.current = key;
      injectStyles(themes);
      writeCache(themes);

      // Remove FOUC style tag once real styles are in place
      const foucStyle = document.getElementById('custom-themes-fouc');
      if (foucStyle) foucStyle.remove();
    }
  }, [docs]);

  const themes = docs?.map(docToCustomTheme) ?? [];

  return {
    customThemes: themes,
    isLoading: docs === undefined,
  };
}

export function useCustomThemeMutations() {
  const createTheme = useMutation(api.customThemes.create);
  const updateTheme = useMutation(api.customThemes.update);
  const removeTheme = useMutation(api.customThemes.remove);
  return { createTheme, updateTheme, removeTheme };
}
