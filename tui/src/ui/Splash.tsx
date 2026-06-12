import { createTextAttributes } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { ACCENT, ACCENT_DARK } from './theme';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

const TAGLINE = 'what should I look at next?';
const CONNECTING = 'connecting to daemon…';

/** Two-lobed sprout from public/favicon.svg — [left lobe, right lobe] per
 *  row. Halves are exactly 13 chars each (equal width is load-bearing for
 *  alignment); the ▌▐ seam stands in for the logo's center vein. */
const SPROUT: ReadonlyArray<readonly [string, string]> = [
  ['   ▄▄█████▄  ', '  ▄█████▄▄   '],
  [' ▄██████████▌', '▐██████████▄ '],
  ['▄███████████▌', '▐███████████▄'],
  ['████████████▌', '▐████████████'],
  ['▀███████████▌', '▐███████████▀'],
  ['  ▀█████████▌', '▐█████████▀  '],
  ['    ▀███████▌', '▐███████▀    '],
  ['       ▀████▌', '▐████▀       '],
  ['          ▀█▌', '▐█▀          '],
];
const ART_WIDTH = 26;

// Full tier needs sidebar(30) + pane border(2) + art(26) + margin cols, and
// 14 content rows + status bar/border/banner chrome. Thresholds are on
// terminal dims — Splash only ever renders in the main pane, so the 30-col
// sidebar width (App.tsx SIDEBAR_WIDTH) is baked in rather than plumbed
// through props. Update these if SIDEBAR_WIDTH changes.
const MIN_FULL_WIDTH = 62;
const MIN_FULL_HEIGHT = 20;

export type SplashMode = 'connecting' | 'empty';

export interface SplashProps {
  mode: SplashMode;
}

export function Splash({ mode }: SplashProps) {
  const dims = useTerminalDimensions();
  const full = dims.width >= MIN_FULL_WIDTH && dims.height >= MIN_FULL_HEIGHT;
  if (!full) {
    return (
      <box
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        justifyContent="center"
      >
        <text>
          <span fg={ACCENT} attributes={BOLD}>
            holo
          </span>
          <span attributes={DIM}>
            {mode === 'connecting' ? ` — ${CONNECTING}` : ' — n: new session'}
          </span>
        </text>
      </box>
    );
  }
  return (
    <box
      flexGrow={1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <box flexDirection="column" width={ART_WIDTH} flexShrink={0}>
        {SPROUT.map(([left, right], i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static art rows
          <text key={i}>
            <span fg={ACCENT}>{left}</span>
            <span fg={ACCENT_DARK}>{right}</span>
          </text>
        ))}
      </box>
      <text> </text>
      <text>
        <span fg={ACCENT} attributes={BOLD}>
          holo
        </span>
      </text>
      <text>
        <span attributes={DIM}>{TAGLINE}</span>
      </text>
      <text> </text>
      {mode === 'connecting' ? (
        <text>
          <span attributes={DIM}>{CONNECTING}</span>
        </text>
      ) : (
        <text>
          <span fg={ACCENT}>n</span>
          <span attributes={DIM}>: new session</span>
        </text>
      )}
    </box>
  );
}
