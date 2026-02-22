export interface CustomTheme {
  id: string;
  name: string;
  colorScheme: 'light' | 'dark';
  background: string; // oklch string, e.g. "0.11 0.02 290"
  foreground: string; // oklch string
  primary: string; // oklch string
  accent: string; // oklch string
  ring: string; // oklch string
  overrides?: Record<string, string>; // advanced mode partial overrides
}

export function parseOklch(str: string): { l: number; c: number; h: number } {
  if (!str) return { l: 0, c: 0, h: 0 };
  const parts = str.trim().split(/\s+/);
  return {
    l: parseFloat(parts[0] ?? '0'),
    c: parseFloat(parts[1] ?? '0'),
    h: parseFloat(parts[2] ?? '0'),
  };
}

export function formatOklch(l: number, c: number, h: number): string {
  return `${+l.toFixed(4)} ${+c.toFixed(4)} ${+h.toFixed(2)}`;
}

function linearize(channel: number): number {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function delinearize(channel: number): number {
  const v =
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
}

function linearRgbToXyz(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  // sRGB D65 matrix
  const x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = r * 0.0193339 + g * 0.119192 + b * 0.9503041;
  return [x, y, z];
}

function xyzToLinearRgb(
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const r = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const g = x * -0.969266 + y * 1.8760108 + z * 0.041556;
  const b = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [r, g, b];
}

function xyzToOklab(x: number, y: number, z: number): [number, number, number] {
  // XYZ to LMS (Bradford-inspired OKLab matrix)
  const l = x * 0.8189330101 + y * 0.3618667424 + z * -0.1288597137;
  const m = x * 0.0329845436 + y * 0.9293118715 + z * 0.0361456387;
  const s = x * 0.0482003018 + y * 0.2643662691 + z * 0.633851707;

  const lCbrt = Math.cbrt(l);
  const mCbrt = Math.cbrt(m);
  const sCbrt = Math.cbrt(s);

  const L = 0.2104542553 * lCbrt + 0.793617785 * mCbrt - 0.0040720468 * sCbrt;
  const a = 1.9779984951 * lCbrt - 2.428592205 * mCbrt + 0.4505937099 * sCbrt;
  const bVal =
    0.0259040371 * lCbrt + 0.7827717662 * mCbrt - 0.808675766 * sCbrt;

  return [L, a, bVal];
}

function oklabToXyz(
  L: number,
  a: number,
  bVal: number,
): [number, number, number] {
  const lCbrt = L + 0.3963377774 * a + 0.2158037573 * bVal;
  const mCbrt = L - 0.1055613458 * a - 0.0638541728 * bVal;
  const sCbrt = L - 0.0894841775 * a - 1.291485548 * bVal;

  const l = lCbrt ** 3;
  const m = mCbrt ** 3;
  const s = sCbrt ** 3;

  const x = l * 1.2270138511 + m * -0.5577999807 + s * 0.281256149;
  const y = l * -0.0405801784 + m * 1.1122568696 + s * -0.0716766787;
  const z = l * -0.0763812845 + m * -0.4214819784 + s * 1.5861632204;

  return [x, y, z];
}

export function hexToOklch(hex: string): { l: number; c: number; h: number } {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);

  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  const [x, y, z] = linearRgbToXyz(lr, lg, lb);
  const [L, a, bVal] = xyzToOklab(x, y, z);

  const c = Math.sqrt(a * a + bVal * bVal);
  let h = (Math.atan2(bVal, a) * 180) / Math.PI;
  if (h < 0) h += 360;

  return { l: L, c, h };
}

export function oklchToHex(l: number, c: number, h: number): string {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const bVal = c * Math.sin(hRad);

  const [x, y, z] = oklabToXyz(l, a, bVal);
  const [lr, lg, lb] = xyzToLinearRgb(x, y, z);

  const r = delinearize(lr);
  const g = delinearize(lg);
  const b = delinearize(lb);

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

export function deriveThemeVariables(
  bg: string,
  fg: string,
  primary: string,
  accent: string,
  ring: string,
  colorScheme: 'light' | 'dark',
  overrides?: Record<string, string>,
): Record<string, string> {
  const { l: bgL, c: bgC, h: bgH } = parseOklch(bg);
  const { l: fgL, c: fgC, h: fgH } = parseOklch(fg);
  const { l: priL, c: priC, h: priH } = parseOklch(primary);
  const { l: accL, c: accC, h: accH } = parseOklch(accent);
  const { l: ringL, c: ringC, h: ringH } = parseOklch(ring);

  const oklch = (l: number, c: number, h: number) =>
    `oklch(${formatOklch(l, c, h)})`;

  const fgStr = oklch(fgL, fgC, fgH);
  const accStr = oklch(accL, accC, accH);

  let vars: Record<string, string>;

  if (colorScheme === 'dark') {
    vars = {
      '--background': oklch(bgL, bgC, bgH),
      '--foreground': fgStr,
      '--card': oklch(bgL + 0.06, bgC, bgH),
      '--card-foreground': fgStr,
      '--popover': oklch(bgL + 0.08, bgC, bgH),
      '--popover-foreground': fgStr,
      '--primary': oklch(priL, priC, priH),
      '--primary-foreground': oklch(0.97, 0.01, priH),
      '--secondary': oklch(bgL + 0.12, bgC + 0.005, bgH),
      '--secondary-foreground': fgStr,
      '--muted': oklch(bgL + 0.12, bgC + 0.005, bgH),
      '--muted-foreground': oklch((bgL + fgL) / 2, fgC, fgH),
      '--accent': accStr,
      '--accent-foreground': fgStr,
      '--destructive': oklch(0.55, 0.2, 25),
      '--destructive-foreground': oklch(0.95, 0.01, 60),
      '--border': oklch(bgL + 0.2, bgC, bgH),
      '--input': oklch(bgL + 0.2, bgC, bgH),
      '--ring': oklch(ringL, ringC, ringH),
    };
  } else {
    const primaryFg =
      priL > 0.6 ? oklch(0.15, 0.01, priH) : oklch(0.97, 0.01, priH);
    vars = {
      '--background': oklch(bgL, bgC, bgH),
      '--foreground': fgStr,
      '--card': oklch(bgL - 0.06, bgC, bgH),
      '--card-foreground': fgStr,
      '--popover': oklch(bgL - 0.08, bgC, bgH),
      '--popover-foreground': fgStr,
      '--primary': oklch(priL, priC, priH),
      '--primary-foreground': primaryFg,
      '--secondary': oklch(bgL - 0.12, bgC + 0.005, bgH),
      '--secondary-foreground': fgStr,
      '--muted': oklch(bgL - 0.12, bgC + 0.005, bgH),
      '--muted-foreground': oklch((bgL + fgL) / 2, fgC, fgH),
      '--accent': accStr,
      '--accent-foreground': fgStr,
      '--destructive': oklch(0.55, 0.2, 25),
      '--destructive-foreground': oklch(0.95, 0.01, 60),
      '--border': oklch(bgL - 0.2, bgC, bgH),
      '--input': oklch(bgL - 0.2, bgC, bgH),
      '--ring': oklch(ringL, ringC, ringH),
    };
  }

  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      vars[key] = value;
    }
  }

  return vars;
}

export function generateThemeCSS(theme: CustomTheme): string {
  const vars = deriveThemeVariables(
    theme.background,
    theme.foreground,
    theme.primary,
    theme.accent,
    theme.ring,
    theme.colorScheme,
    theme.overrides,
  );

  const lines = Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join('\n');

  return `[data-theme="custom-${theme.id}"] {\n  color-scheme: ${theme.colorScheme};\n${lines}\n  --radius: 0.5rem;\n}`;
}
