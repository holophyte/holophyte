import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Splash } from './Splash';
import { renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-ui-'));
});

// Widest art row — contiguous across the color seam in the char frame.
const WIDE_ROW = '████████████▌▐████████████';

describe('Splash', () => {
  it('full tier, empty mode: art, wordmark, tagline, and n hint', async () => {
    const { frame, unmount } = await renderSetup(<Splash mode="empty" />);
    const out = frame();
    expect(out).toContain(WIDE_ROW);
    expect(out).toContain('holo');
    expect(out).toContain('what should I look at next?');
    expect(out).toContain('n: new session');
    expect(out).not.toContain('connecting to daemon…');
    unmount();
  });

  it('full tier, connecting mode: connecting subtitle, no n hint', async () => {
    const { frame, unmount } = await renderSetup(<Splash mode="connecting" />);
    const out = frame();
    expect(out).toContain('connecting to daemon…');
    expect(out).toContain(WIDE_ROW);
    expect(out).not.toContain('n: new session');
    unmount();
  });

  it('compact tier: one-line splash, no art', async () => {
    const { frame, unmount } = await renderSetup(<Splash mode="empty" />, {
      width: 50,
      height: 14,
    });
    const out = frame();
    expect(out).not.toContain('▌▐');
    expect(out).not.toContain('▄▄█████▄');
    expect(out).toContain('holo — n: new session');
    unmount();
  });

  it('centers the art (top row is not flush-left)', async () => {
    const { frame, unmount } = await renderSetup(<Splash mode="empty" />);
    expect(frame()).toMatch(/ {10,}▄▄█████▄/);
    unmount();
  });
});
