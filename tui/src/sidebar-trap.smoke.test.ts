/**
 * Real-tmux regression tripwire for the sidebar death trap's empirical premise
 * (verified by the judge on tmux 3.6b). Gated — needs a real tmux server and a
 * non-sandboxed run (the sandbox blocks Unix-socket creation):
 *   HOLO_SMOKE=tmux  bun node_modules/vitest/vitest.mjs run src/sidebar-trap.smoke.test.ts
 *   HOLO_SMOKE=all
 *
 * Uses an ISOLATED `tmux -S <tmpdir>/tmux.sock` server — never the live server
 * or ~/.holo. The server is killed and the tmpdir removed in teardown.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultRunner, RealTmux, type TmuxRunner } from './tmux';

const SMOKE = process.env.HOLO_SMOKE ?? '';
const RUN = SMOKE === 'tmux' || SMOKE === 'all';

describe.skipIf(!RUN)('sidebar death trap (HOLO_SMOKE=tmux gated)', () => {
  let dir = '';
  let runner: TmuxRunner;
  let tmux: RealTmux;

  async function windowAlive(windowId: string): Promise<boolean> {
    return (await tmux.listWindowIds()).includes(windowId);
  }

  async function waitForGone(
    windowId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await windowAlive(windowId))) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return !(await windowAlive(windowId));
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'holo-trap-'));
    const sock = join(dir, 'tmux.sock');
    runner = (args) => defaultRunner(['-S', sock, ...args]);
    tmux = new RealTmux(runner, 'holo');
    // a detached session is required before new-window can target it
    await runner([
      'new-session',
      '-d',
      '-s',
      'holo',
      '-n',
      'tui',
      'sleep',
      '600',
    ]);
  });

  afterAll(async () => {
    await runner(['kill-server']).catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('trap + sidebar: agent exit closes the whole window', async () => {
    const { windowId, paneId } = await tmux.newWindow({
      name: 'agent',
      cwd: dir,
      argv: ['sh', '-c', 'sleep 0.3'],
    });
    expect(await tmux.setKillWindowOnPaneDeath(paneId, windowId)).toBe(true);
    await tmux.splitSidebar({ paneId, argv: ['sleep', '600'], widthCols: 30 });
    expect(await waitForGone(windowId, 3000)).toBe(true);
  });

  it('control: without the trap the window survives sidebar-only', async () => {
    const { windowId, paneId } = await tmux.newWindow({
      name: 'leak',
      cwd: dir,
      argv: ['sh', '-c', 'sleep 0.3'],
    });
    await tmux.splitSidebar({ paneId, argv: ['sleep', '600'], widthCols: 30 });
    // no trap → the agent pane dies but the window stays open on the sidebar
    expect(await waitForGone(windowId, 1500)).toBe(false);
    await tmux.selectWindow(windowId); // keep it tidy; teardown kills the server
  });

  it('sidebar killed first: window still closes on agent exit', async () => {
    const { windowId, paneId } = await tmux.newWindow({
      name: 'agent2',
      cwd: dir,
      argv: ['sh', '-c', 'sleep 0.6'],
    });
    expect(await tmux.setKillWindowOnPaneDeath(paneId, windowId)).toBe(true);
    await tmux.splitSidebar({ paneId, argv: ['sleep', '600'], widthCols: 30 });
    // kill the sidebar pane first — leaves the trapped single-pane window
    await runner(['kill-pane', '-t', `${windowId}.1`]);
    expect(await waitForGone(windowId, 3000)).toBe(true);
  });
});
