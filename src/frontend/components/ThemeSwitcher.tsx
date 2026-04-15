import type { CSSProperties } from 'react';
import { cn } from '@/frontend/lib/utils';
import type { ThemePreference } from '@/frontend/stores/app';
import { useAppStore } from '@/frontend/stores/app';

interface Palette {
  bg: string;
  surface: string;
  primary: string;
  accent: string;
}

/** Preview hex colors are hand-picked approximations of the oklch values in
 *  styles.css. Update these when theme palettes change. */
const LIGHT: Palette = {
  bg: '#f4eee3',
  surface: '#fbf7ee',
  primary: '#c4408a',
  accent: '#2b8fb3',
};

const DARK: Palette = {
  bg: '#0f0e11',
  surface: '#15141b',
  primary: '#ffa5e9',
  accent: '#5ddbff',
};

interface ThemeOption {
  name: ThemePreference;
  label: string;
}

const THEMES: ThemeOption[] = [
  { name: 'system', label: 'System' },
  { name: 'dark', label: 'Dark' },
  { name: 'light', label: 'Light' },
];

function Swatch({
  palette,
  className,
  style,
}: {
  palette: Palette;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn('flex h-6 w-full rounded-sm overflow-hidden', className)}
      style={{
        background: palette.bg,
        boxShadow: 'inset 0 0 0 1px oklch(0.5 0 0 / 0.15)',
        ...style,
      }}
    >
      <div
        className="flex-1 m-[3px] mr-0 rounded-[2px] flex items-end px-[3px] pb-[3px] gap-[2px]"
        style={{ background: palette.surface }}
      >
        <div
          className="w-[4px] h-[4px] rounded-full"
          style={{ background: palette.primary }}
        />
        <div
          className="w-[4px] h-[3px] rounded-sm"
          style={{ background: palette.accent }}
        />
      </div>
      <div
        className="w-[4px] m-[3px] ml-[2px] rounded-[1px]"
        style={{
          background: `linear-gradient(180deg, ${palette.primary}, ${palette.accent})`,
        }}
      />
    </div>
  );
}

function SystemSwatch() {
  const fade = 'linear-gradient(135deg, black 35%, transparent 65%)';
  return (
    <div className="relative h-6 w-full rounded-sm overflow-hidden">
      <Swatch palette={DARK} className="absolute inset-0 rounded-none" />
      <Swatch
        palette={LIGHT}
        className="absolute inset-0 rounded-none"
        style={{ maskImage: fade, WebkitMaskImage: fade }}
      />
    </div>
  );
}

export function ThemeSwitcher() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="text-xs font-medium text-muted-foreground px-1 mb-1.5">
        Theme
      </legend>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
        {THEMES.map((t) => {
          const isActive = theme === t.name;
          return (
            // biome-ignore lint/a11y/useSemanticElements: styled radio group using buttons
            <button
              key={t.name}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`${t.label} theme`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setTheme(t.name)}
              onKeyDown={(e) => {
                const keys = [
                  'ArrowRight',
                  'ArrowDown',
                  'ArrowLeft',
                  'ArrowUp',
                ];
                const dir = keys.indexOf(e.key);
                if (dir === -1) return;
                e.preventDefault();
                const delta = dir < 2 ? 1 : -1;
                const next =
                  (THEMES.indexOf(t) + delta + THEMES.length) % THEMES.length;
                const nextTheme = THEMES[next];
                if (!nextTheme) return;
                setTheme(nextTheme.name);
                (
                  e.currentTarget.parentElement?.children[next] as HTMLElement
                )?.focus();
              }}
              className={cn(
                'relative flex flex-col items-center gap-1 rounded-md p-1.5 text-[11px] transition-all cursor-pointer',
                isActive ? 'ring-2 ring-ring bg-accent' : 'hover:bg-accent/50',
              )}
            >
              {t.name === 'system' ? (
                <SystemSwatch />
              ) : (
                <Swatch palette={t.name === 'light' ? LIGHT : DARK} />
              )}
              <span className="text-muted-foreground leading-none">
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
