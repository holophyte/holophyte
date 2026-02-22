import type { Id } from '@convex/_generated/dataModel';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useCustomThemeMutations,
  useCustomThemes,
} from '@/frontend/hooks/useCustomThemes';
import type { CustomTheme } from '@/frontend/lib/theme';
import {
  deriveThemeVariables,
  formatOklch,
  hexToOklch,
  oklchToHex,
} from '@/frontend/lib/theme';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import PageHeader from './ui/PageHeader';

const CSS_VAR_NAMES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
] as const;

function oklchStringToHex(oklchStr: string): string {
  try {
    const parts = oklchStr.trim().split(/\s+/);
    const l = parseFloat(parts[0] ?? '0');
    const c = parseFloat(parts[1] ?? '0');
    const h = parseFloat(parts[2] ?? '0');
    return oklchToHex(l, c, h);
  } catch {
    return '#000000';
  }
}

function hexToOklchString(hex: string): string {
  const { l, c, h } = hexToOklch(hex);
  return formatOklch(l, c, h);
}

export default function ThemeCreatorPage() {
  const editingThemeId = useAppStore((s) => s.editingThemeId);
  const closeThemeCreator = useAppStore((s) => s.closeThemeCreator);
  const setTheme = useAppStore((s) => s.setTheme);

  const { customThemes } = useCustomThemes();
  const { createTheme, updateTheme, removeTheme } = useCustomThemeMutations();

  const [name, setName] = useState('My Theme');
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>('dark');
  const [bgHex, setBgHex] = useState('#08060f');
  const [primaryHex, setPrimaryHex] = useState('#ff3296');
  const [ringHex, setRingHex] = useState('#00dce8');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Populate form from existing theme when editing
  useEffect(() => {
    if (!editingThemeId) return;
    const theme = customThemes.find(
      (t: CustomTheme) => t.id === editingThemeId,
    );
    if (!theme) return;

    setName(theme.name);
    setColorScheme(theme.colorScheme);
    setBgHex(oklchStringToHex(theme.background));
    setPrimaryHex(oklchStringToHex(theme.primary));
    setRingHex(oklchStringToHex(theme.ring));
    setOverrides(theme.overrides ?? {});
  }, [editingThemeId, customThemes]);

  const bgOklch = hexToOklchString(bgHex);
  const primaryOklch = hexToOklchString(primaryHex);
  const ringOklch = hexToOklchString(ringHex);

  const derivedVars = useMemo(
    () =>
      deriveThemeVariables(
        bgOklch,
        primaryOklch,
        ringOklch,
        colorScheme,
        overrides,
      ),
    [bgOklch, primaryOklch, ringOklch, colorScheme, overrides],
  );

  function handleAdvancedOverride(varName: string, hex: string) {
    setOverrides((prev) => ({
      ...prev,
      [varName]: `oklch(${hexToOklchString(hex)})`,
    }));
  }

  function clearOverride(varName: string) {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[varName];
      return next;
    });
  }

  async function handleSave() {
    const overridesStr =
      Object.keys(overrides).length > 0 ? JSON.stringify(overrides) : undefined;

    if (editingThemeId) {
      await updateTheme({
        id: editingThemeId as Id<'customThemes'>,
        name,
        colorScheme,
        background: bgOklch,
        primary: primaryOklch,
        ring: ringOklch,
        overrides: overridesStr,
      });
      setTheme(`custom-${editingThemeId}`);
    } else {
      const newId = await createTheme({
        name,
        colorScheme,
        background: bgOklch,
        primary: primaryOklch,
        ring: ringOklch,
        overrides: overridesStr,
      });
      if (newId) {
        setTheme(`custom-${newId}`);
      }
    }
    closeThemeCreator();
  }

  async function handleDelete() {
    if (!editingThemeId) return;
    await removeTheme({ id: editingThemeId as Id<'customThemes'> });
    setTheme('neon');
    closeThemeCreator();
  }

  // Helper to get the current value (override or derived) for an advanced var as hex
  function getVarHex(varName: string): string {
    const override = overrides[varName];
    if (override) {
      // overrides are stored as "oklch(...)" strings
      const inner = override.replace(/^oklch\(/, '').replace(/\)$/, '');
      return oklchStringToHex(inner);
    }
    const derived = derivedVars[varName];
    if (derived) {
      const inner = derived.replace(/^oklch\(/, '').replace(/\)$/, '');
      return oklchStringToHex(inner);
    }
    return '#000000';
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader>
        <Button
          variant="ghost"
          size="icon"
          onClick={closeThemeCreator}
          className="mr-2"
        >
          <ArrowLeft />
        </Button>
        <span className="font-semibold text-sm">Theme Creator</span>
      </PageHeader>

      <div className="flex flex-1 min-h-0">
        {/* Left Panel — Controls */}
        <div className="w-80 shrink-0 flex flex-col border-r overflow-y-auto">
          <div className="flex flex-col gap-5 p-4 flex-1">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="theme-name">Theme Name</Label>
              <Input
                id="theme-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="My Theme"
              />
            </div>

            {/* Color Scheme */}
            <div className="flex flex-col gap-1.5">
              <Label>Color Scheme</Label>
              <div className="flex rounded-md border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setColorScheme('dark')}
                  className={cn(
                    'flex-1 py-1.5 text-sm font-medium transition-colors',
                    colorScheme === 'dark'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  Dark
                </button>
                <button
                  type="button"
                  onClick={() => setColorScheme('light')}
                  className={cn(
                    'flex-1 py-1.5 text-sm font-medium transition-colors',
                    colorScheme === 'light'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  Light
                </button>
              </div>
            </div>

            {/* Color Pickers */}
            <ColorPickerField
              label="Background"
              hex={bgHex}
              onChange={setBgHex}
            />
            <ColorPickerField
              label="Primary"
              hex={primaryHex}
              onChange={setPrimaryHex}
            />
            <ColorPickerField
              label="Ring"
              hex={ringHex}
              onChange={setRingHex}
            />

            {/* Advanced */}
            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <ChevronRight
                  className={cn(
                    'size-4 transition-transform',
                    advancedOpen && 'rotate-90',
                  )}
                />
                Advanced ({CSS_VAR_NAMES.length} vars)
              </button>

              {advancedOpen && (
                <div className="mt-3 flex flex-col gap-3">
                  {CSS_VAR_NAMES.map((varName) => {
                    const hasOverride = varName in overrides;
                    return (
                      <div key={varName} className="flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-mono text-muted-foreground">
                            {varName}
                          </Label>
                          {hasOverride && (
                            <button
                              type="button"
                              onClick={() => clearOverride(varName)}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <AdvancedColorInput
                          hex={getVarHex(varName)}
                          hasOverride={hasOverride}
                          onChange={(hex) =>
                            handleAdvancedOverride(varName, hex)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 p-4 border-t">
            <Button onClick={handleSave} className="flex-1">
              Save
            </Button>
            {editingThemeId && (
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
        </div>

        {/* Right Panel — Live Preview */}
        <div className="flex-1 flex items-center justify-center p-6 overflow-auto">
          <div className="w-full max-w-sm">
            <p className="text-xs text-muted-foreground mb-3 font-medium uppercase tracking-wider">
              Live Preview
            </p>
            <ThemePreview vars={derivedVars} />
          </div>
        </div>
      </div>
    </div>
  );
}

interface ColorPickerFieldProps {
  label: string;
  hex: string;
  onChange: (hex: string) => void;
}

const DEBOUNCE_MS = 50;

function useDebouncedCallback(cb: (value: string) => void, delay: number) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef(cb);
  latest.current = cb;

  return useCallback(
    (value: string) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => latest.current(value), delay);
    },
    [delay],
  );
}

function ColorPickerField({ label, hex, onChange }: ColorPickerFieldProps) {
  const [local, setLocal] = useState(hex);
  const debouncedOnChange = useDebouncedCallback(onChange, DEBOUNCE_MS);

  // Sync from parent when hex changes externally (e.g. loading a theme)
  useEffect(() => {
    setLocal(hex);
  }, [hex]);

  function handleColorInput(value: string) {
    setLocal(value);
    debouncedOnChange(value);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={local}
          onChange={(e) => handleColorInput(e.target.value)}
          className="h-9 w-12 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
        />
        <Input
          value={local}
          onChange={(e) => {
            const val = e.target.value;
            setLocal(val);
            if (/^#[0-9a-fA-F]{6}$/.test(val)) debouncedOnChange(val);
          }}
          placeholder="#000000"
          className="font-mono text-xs flex-1"
          maxLength={7}
        />
      </div>
    </div>
  );
}

interface AdvancedColorInputProps {
  hex: string;
  hasOverride: boolean;
  onChange: (hex: string) => void;
}

function AdvancedColorInput({
  hex,
  hasOverride,
  onChange,
}: AdvancedColorInputProps) {
  const [local, setLocal] = useState(hex);
  const debouncedOnChange = useDebouncedCallback(onChange, DEBOUNCE_MS);

  useEffect(() => {
    setLocal(hex);
  }, [hex]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={local}
        onChange={(e) => {
          setLocal(e.target.value);
          debouncedOnChange(e.target.value);
        }}
        className="h-7 w-10 cursor-pointer rounded border border-input bg-transparent p-0.5"
      />
      <span className="text-xs font-mono text-muted-foreground">{local}</span>
      {hasOverride && (
        <span className="text-xs text-primary ml-auto">custom</span>
      )}
    </div>
  );
}

interface ThemePreviewProps {
  vars: Record<string, string>;
}

function ThemePreview({ vars }: ThemePreviewProps) {
  const bg = vars['--background'] ?? 'oklch(0.1 0 0)';
  const fg = vars['--foreground'] ?? 'oklch(0.9 0 0)';
  const card = vars['--card'] ?? 'oklch(0.15 0 0)';
  const cardFg = vars['--card-foreground'] ?? fg;
  const primary = vars['--primary'] ?? 'oklch(0.6 0.2 300)';
  const primaryFg = vars['--primary-foreground'] ?? 'oklch(0.97 0 0)';
  const secondary = vars['--secondary'] ?? 'oklch(0.2 0 0)';
  const secondaryFg = vars['--secondary-foreground'] ?? fg;
  const muted = vars['--muted'] ?? 'oklch(0.2 0 0)';
  const mutedFg = vars['--muted-foreground'] ?? 'oklch(0.65 0 0)';
  const accent = vars['--accent'] ?? 'oklch(0.22 0 0)';
  const border = vars['--border'] ?? 'oklch(0.3 0 0)';
  const ring = vars['--ring'] ?? primary;
  const destructive = vars['--destructive'] ?? 'oklch(0.55 0.2 25)';
  const destructiveFg = vars['--destructive-foreground'] ?? 'oklch(0.95 0 0)';

  return (
    <div style={{ background: bg, padding: '16px', borderRadius: '12px' }}>
      {/* Card */}
      <div
        style={{
          background: card,
          borderRadius: '8px',
          padding: '16px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
        }}
      >
        <p
          style={{
            color: cardFg,
            fontWeight: 600,
            fontSize: '15px',
            margin: 0,
          }}
        >
          Card Title
        </p>

        {/* Primary Button */}
        <button
          type="button"
          style={{
            background: primary,
            color: primaryFg,
            border: 'none',
            borderRadius: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'default',
            display: 'inline-block',
            alignSelf: 'flex-start',
          }}
        >
          Primary Button
        </button>

        {/* Muted text */}
        <p style={{ color: mutedFg, fontSize: '13px', margin: 0 }}>
          Muted text sample
        </p>

        {/* Divider */}
        <div style={{ height: '1px', background: border }} />

        {/* Accent area */}
        <div
          style={{
            background: accent,
            borderRadius: '6px',
            padding: '8px 12px',
            color: fg,
            fontSize: '13px',
          }}
        >
          Accent area
        </div>

        {/* Secondary button */}
        <button
          type="button"
          style={{
            background: secondary,
            color: secondaryFg,
            border: 'none',
            borderRadius: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'default',
            display: 'inline-block',
            alignSelf: 'flex-start',
          }}
        >
          Secondary Button
        </button>
      </div>

      {/* Ring sample */}
      <div
        style={{
          marginTop: '12px',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <p
          style={{
            color: mutedFg,
            fontSize: '11px',
            margin: 0,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Focus ring sample
        </p>
        <div
          style={{
            background: muted,
            borderRadius: '6px',
            padding: '7px 12px',
            fontSize: '13px',
            color: fg,
            outline: `2px solid ${ring}`,
            outlineOffset: '2px',
          }}
        >
          Focused input
        </div>

        {/* Destructive button */}
        <button
          type="button"
          style={{
            background: destructive,
            color: destructiveFg,
            border: 'none',
            borderRadius: '6px',
            padding: '7px 14px',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'default',
            display: 'inline-block',
            alignSelf: 'flex-start',
            marginTop: '4px',
          }}
        >
          Destructive
        </button>
      </div>
    </div>
  );
}
