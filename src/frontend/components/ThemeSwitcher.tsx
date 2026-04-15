import { Check } from 'lucide-react';
import { cn } from '@/frontend/lib/utils';
import type { ThemeName } from '@/frontend/stores/app';
import { useAppStore } from '@/frontend/stores/app';

interface ThemeOption {
  name: ThemeName;
  label: string;
  /** Static hex preview colors — hardcoded because previews
   *  render independently of the active theme's CSS variables. */
  bg: string;
  surface: string;
  primary: string;
  accent: string;
}

/** Preview hex colors are hand-picked approximations of the oklch values in
 *  styles.css. Update these when theme palettes change. */
const THEMES: ThemeOption[] = [
  {
    name: 'dark',
    label: 'Dark',
    bg: '#0f0e11',
    surface: '#15141b',
    primary: '#ffa5e9',
    accent: '#5ddbff',
  },
  {
    name: 'light',
    label: 'Light',
    bg: '#f4eee3',
    surface: '#fbf7ee',
    primary: '#c4408a',
    accent: '#2b8fb3',
  },
];

export function ThemeSwitcher() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="text-xs font-medium text-muted-foreground px-1 mb-1.5">
        Theme
      </legend>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
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
              {/* Mini swatch showing color tension */}
              <div
                className="flex h-6 w-full rounded-sm overflow-hidden"
                style={{
                  backgroundColor: t.bg,
                  boxShadow: 'inset 0 0 0 1px oklch(0.5 0 0 / 0.15)',
                }}
              >
                {/* Surface card preview */}
                <div
                  className="flex-1 m-[3px] mr-0 rounded-[2px] flex items-end px-[3px] pb-[3px] gap-[2px]"
                  style={{ backgroundColor: t.surface }}
                >
                  <div
                    className="w-[4px] h-[4px] rounded-full"
                    style={{ backgroundColor: t.primary }}
                  />
                  <div
                    className="w-[4px] h-[3px] rounded-sm"
                    style={{ backgroundColor: t.accent }}
                  />
                </div>
                {/* Accent bar */}
                <div
                  className="w-[4px] m-[3px] ml-[2px] rounded-[1px]"
                  style={{
                    background: `linear-gradient(180deg, ${t.primary}, ${t.accent})`,
                  }}
                />
              </div>
              <span className="text-muted-foreground leading-none">
                {t.label}
              </span>
              {isActive && (
                <Check
                  className="absolute top-0.5 right-0.5 h-3 w-3 text-primary"
                  aria-hidden="true"
                />
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
