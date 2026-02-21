import { Check, Pencil, Plus } from 'lucide-react';
import { useCustomThemes } from '@/frontend/hooks/useCustomThemes';
import { oklchToHex, parseOklch } from '@/frontend/lib/theme';
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
    name: 'neon',
    label: 'Neon',
    bg: '#08060f',
    surface: '#100c1c',
    primary: '#ff3296',
    accent: '#00dce8',
  },
  {
    name: 'flora',
    label: 'Flora',
    bg: '#08070e',
    surface: '#120e1a',
    primary: '#f050a0',
    accent: '#28c864',
  },
  {
    name: 'infrared',
    label: 'Infrared',
    bg: '#080505',
    surface: '#120c0c',
    primary: '#ff1e5a',
    accent: '#20e0d0',
  },
  {
    name: 'verdant',
    label: 'Verdant',
    bg: '#0b1a12',
    surface: '#132b20',
    primary: '#e88055',
    accent: '#5cc4a8',
  },
  {
    name: 'rosewood',
    label: 'Rosewood',
    bg: '#1e0f22',
    surface: '#281830',
    primary: '#d4a870',
    accent: '#c070a0',
  },
  {
    name: 'paper',
    label: 'Paper',
    bg: '#f5f0e6',
    surface: '#fcfaf6',
    primary: '#a85230',
    accent: '#d8d0c0',
  },
  {
    name: 'dune',
    label: 'Dune',
    bg: '#f0e4cc',
    surface: '#faf4e4',
    primary: '#0f508c',
    accent: '#d48830',
  },
  {
    name: 'arctic',
    label: 'Arctic',
    bg: '#f0eff8',
    surface: '#fafafe',
    primary: '#7c3aed',
    accent: '#d0cee0',
  },
];

export function ThemeSwitcher() {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const { customThemes } = useCustomThemes();
  const openThemeCreator = useAppStore((s) => s.openThemeCreator);

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="text-xs font-medium text-muted-foreground px-1 mb-1.5">
        Theme
      </legend>
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup">
        {THEMES.map((t) => {
          const isActive = theme === t.name;
          return (
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
      {/* Custom Themes */}
      {
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-muted-foreground px-1">
              Custom
            </span>
            <button
              type="button"
              onClick={() => openThemeCreator()}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-1"
            >
              <Plus className="h-3 w-3" />
              Create
            </button>
          </div>
          {customThemes.length > 0 && (
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup">
              {customThemes.map((t) => {
                const themeKey = `custom-${t.id}` as const;
                const isActive = theme === themeKey;
                // Convert oklch strings to hex for preview swatches
                const bgParsed = parseOklch(t.background);
                const bgHex = oklchToHex(bgParsed.l, bgParsed.c, bgParsed.h);
                const priParsed = parseOklch(t.primary);
                const priHex = oklchToHex(
                  priParsed.l,
                  priParsed.c,
                  priParsed.h,
                );
                const ringParsed = parseOklch(t.ring);
                const ringHex = oklchToHex(
                  ringParsed.l,
                  ringParsed.c,
                  ringParsed.h,
                );
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    aria-label={`${t.name} theme`}
                    onClick={() => setTheme(themeKey)}
                    className={cn(
                      'relative flex flex-col items-center gap-1 rounded-md p-1.5 text-[11px] transition-all cursor-pointer group',
                      isActive
                        ? 'ring-2 ring-ring bg-accent'
                        : 'hover:bg-accent/50',
                    )}
                  >
                    {/* Mini swatch */}
                    <div
                      className="flex h-6 w-full rounded-sm overflow-hidden"
                      style={{
                        backgroundColor: bgHex,
                        boxShadow: 'inset 0 0 0 1px oklch(0.5 0 0 / 0.15)',
                      }}
                    >
                      <div
                        className="flex-1 m-[3px] mr-0 rounded-[2px] flex items-end px-[3px] pb-[3px] gap-[2px]"
                        style={{
                          backgroundColor:
                            t.colorScheme === 'dark'
                              ? `color-mix(in oklch, ${bgHex}, white 15%)`
                              : `color-mix(in oklch, ${bgHex}, black 8%)`,
                        }}
                      >
                        <div
                          className="w-[4px] h-[4px] rounded-full"
                          style={{ backgroundColor: priHex }}
                        />
                        <div
                          className="w-[4px] h-[3px] rounded-sm"
                          style={{ backgroundColor: ringHex }}
                        />
                      </div>
                      <div
                        className="w-[4px] m-[3px] ml-[2px] rounded-[1px]"
                        style={{
                          background: `linear-gradient(180deg, ${priHex}, ${ringHex})`,
                        }}
                      />
                    </div>
                    <span className="text-muted-foreground leading-none truncate w-full text-center">
                      {t.name}
                    </span>
                    {isActive && (
                      <Check
                        className="absolute top-0.5 right-0.5 h-3 w-3 text-primary"
                        aria-hidden="true"
                      />
                    )}
                    {/* Edit button — visible on hover */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openThemeCreator(t.id);
                      }}
                      className="absolute top-0.5 left-0.5 h-4 w-4 rounded-sm flex items-center justify-center bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label={`Edit ${t.name} theme`}
                    >
                      <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      }
    </fieldset>
  );
}
