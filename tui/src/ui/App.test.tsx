import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildQueue } from '../daemon/scoring';
import type { StatePush } from '../protocol';
import type { Session } from '../types';
import { App } from './App';
import { FakeGateway, renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-ui-'));
});

function session(over: Partial<Session> & Pick<Session, 'id'>): Session {
  const now = Date.now();
  return {
    harness: 'claude',
    cwd: '/Users/x/Development/relos',
    tmuxWindow: '@1',
    status: 'running',
    createdAt: now - 120_000,
    statusSince: now - 30_000,
    ...over,
  };
}

function snapshot(sessions: Session[]): StatePush {
  return {
    type: 'state',
    sessions,
    queue: buildQueue(sessions, Date.now()),
    harnesses: [
      { id: 'claude', configured: true },
      { id: 'codex', configured: true },
      { id: 'cursor', configured: false },
    ],
    recentCwds: [],
  };
}

async function mount() {
  const gw = new FakeGateway();
  const quits: number[] = [];
  const el = await renderSetup(
    <App
      gateway={gw}
      onQuit={() => quits.push(1)}
      devRoot={join(tmpdir(), 'holo-ui-no-such-dir')}
      diffStat={async () => 'FAKE DIFFSTAT'}
    />,
  );
  const push = async (s: StatePush) => {
    await act(async () => {
      gw.pushState(s);
    });
    await el.update();
  };
  return { ...el, gw, quits, push };
}

const needsInput = () =>
  session({
    id: 'claude-1',
    status: 'needs_input',
    attentionReason: 'Clarify naming convention',
  });
const running = () =>
  session({
    id: 'codex-1',
    harness: 'codex',
    cwd: '/Users/x/Development/holophyte',
  });
const idle = () =>
  session({
    id: 'claude-2',
    status: 'idle',
    attentionReason: 'review / next prompt',
  });
const withPermission = () =>
  session({
    id: 'claude-1',
    status: 'permission',
    attentionReason: 'approve: Bash',
    pendingPermission: {
      tool: 'Bash',
      input: { command: 'rm -rf node_modules' },
      respondBy: Date.now() + 30_000,
    },
  });
const exited = () =>
  session({
    id: 'claude-9',
    status: 'exited',
    attentionReason: 'window closed',
    harnessSessionId: 'conv-9',
  });

describe('App', () => {
  it('renders sessions, queue, and reasons from a pushed snapshot', async () => {
    const { push, frame, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    const out = frame();
    expect(out).toContain('SESSIONS');
    expect(out).toContain('QUEUE');
    expect(out).toContain('claude-1');
    expect(out).toContain('codex-1');
    expect(out).toContain('Clarify naming convention');
    expect(out).toContain('FAKE DIFFSTAT'); // preview diffstat (injected fake)
    unmount();
  });

  it('shows the explicit empty-queue message with the running count', async () => {
    const { push, frame, unmount } = await mount();
    await push(snapshot([running(), session({ id: 'claude-3', cwd: '/x' })]));
    expect(frame()).toContain('All 2 agents running — nothing needs you.');
    unmount();
  });

  it('shows a disconnected banner when the subscription closes', async () => {
    const { push, gw, frame, update, unmount } = await mount();
    await push(snapshot([running()]));
    expect(frame()).not.toContain('daemon disconnected');
    await act(async () => {
      gw.dropConnection();
    });
    await update();
    expect(frame()).toContain('daemon disconnected — retrying…');
    unmount();
  });

  it('moves queue selection with j/k', async () => {
    const { push, input, frame, update, unmount } = await mount();
    await push(snapshot([needsInput(), idle(), running()]));
    expect(frame()).toMatch(/› 1\. claude-1/);
    input.pressKey('j');
    await update();
    expect(frame()).toMatch(/› 2\. claude-2/);
    input.pressKey('k');
    await update();
    expect(frame()).toMatch(/› 1\. claude-1/);
    unmount();
  });

  it('tab switches focus from queue to sessions', async () => {
    const { push, input, frame, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    expect(frame()).toContain('▸ QUEUE');
    input.pressTab();
    await update();
    const out = frame();
    expect(out).toContain('▸ SESSIONS');
    expect(out).not.toContain('▸ QUEUE');
    unmount();
  });

  it('enter sends a jump command for the selected session', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    input.pressEnter();
    await update();
    expect(gw.requests).toContainEqual({ cmd: 'jump', sessionId: 'claude-1' });
    unmount();
  });

  it('a/d respond to a pending permission on the selected item', async () => {
    const { push, input, gw, frame, update, unmount } = await mount();
    await push(snapshot([withPermission(), running()]));
    expect(frame()).toContain('[a]pprove');
    input.pressKey('a');
    await update();
    expect(gw.requests).toContainEqual({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    input.pressKey('d');
    await update();
    expect(gw.requests).toContainEqual({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: false,
    });
    unmount();
  });

  it('a does nothing when the selected session has no pending permission', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    input.pressKey('a');
    await update();
    expect(
      gw.requests.filter((r) => r.cmd === 'respondPermission'),
    ).toHaveLength(0);
    unmount();
  });

  it('r resumes the selected exited session in the sessions pane', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([running(), exited()]));
    input.pressTab(); // queue → sessions focus
    await update();
    input.pressKey('j'); // codex-1 → claude-9 (exited)
    await update();
    input.pressKey('r');
    await update();
    expect(gw.requests).toContainEqual({
      cmd: 'resume',
      sessionId: 'claude-9',
    });
    unmount();
  });

  it('r does nothing when the selected session is not exited', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([running(), exited()]));
    input.pressTab(); // sessions focus, codex-1 (running) selected
    await update();
    input.pressKey('r');
    await update();
    expect(gw.requests.filter((r) => r.cmd === 'resume')).toHaveLength(0);
    unmount();
  });

  it('r does nothing with queue focus (exited sessions never queue)', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), exited()]));
    input.pressKey('r'); // queue focus, claude-1 (needs_input) selected
    await update();
    expect(gw.requests.filter((r) => r.cmd === 'resume')).toHaveLength(0);
    unmount();
  });

  it('shows the r:resume hint in the status bar', async () => {
    const { push, frame, unmount } = await mount();
    await push(snapshot([running()]));
    expect(frame()).toContain('r:resume');
    unmount();
  });

  it('q calls onQuit', async () => {
    const { push, input, quits, unmount } = await mount();
    await push(snapshot([running()]));
    input.pressKey('q');
    expect(quits).toHaveLength(1);
    unmount();
  });

  it('n opens the new-session modal', async () => {
    const { push, input, frame, update, unmount } = await mount();
    await push(snapshot([running()]));
    input.pressKey('n');
    await update();
    expect(frame()).toContain('New Session');
    unmount();
  });

  // Splash sentinels: never assert on 'holo' here — FakeGateway cwds contain
  // '/Users/x/Development/holophyte'. Use the tagline or the widest art row.
  // The centered modal occludes the art's middle rows, so never assert art
  // rows while the modal is open.
  const TAGLINE = 'what should I look at next?';
  const WIDE_ROW = '████████████▌▐████████████';

  it('shows the connecting splash before the first push', async () => {
    const { frame, unmount } = await mount();
    const out = frame();
    expect(out).toContain(TAGLINE);
    expect(out).toContain('connecting to daemon…');
    expect(out).not.toContain('New Session');
    unmount();
  });

  it('auto-opens the picker on an empty first snapshot', async () => {
    const { push, input, frame, update, unmount } = await mount();
    await push(snapshot([]));
    expect(frame()).toContain('New Session');
    // The very first keystroke drives session creation.
    input.pressKey('1');
    await update();
    expect(frame()).toContain('New claude session — where?');
    unmount();
  });

  it('esc is final — the picker never auto-reopens, manual n still works', async () => {
    const { push, input, frame, update, unmount } = await mount();
    await push(snapshot([]));
    await input.pressEscape();
    await update();
    const out = frame();
    expect(out).toContain('n: new session');
    expect(out).toContain(WIDE_ROW);
    expect(out).not.toContain('New Session');
    await push(snapshot([]));
    expect(frame()).not.toContain('New Session');
    input.pressKey('n');
    await update();
    expect(frame()).toContain('New Session');
    unmount();
  });

  it('non-empty first snapshot never auto-opens; later drain shows the splash without the modal', async () => {
    const { push, frame, unmount } = await mount();
    await push(snapshot([running()]));
    const board = frame();
    expect(board).toContain('codex-1');
    expect(board).not.toContain('New Session');
    expect(board).not.toContain(TAGLINE);
    await push(snapshot([]));
    const splash = frame();
    expect(splash).toContain(TAGLINE);
    expect(splash).toContain(WIDE_ROW);
    expect(splash).not.toContain('New Session');
    unmount();
  });

  it('disconnected banner and the splash coexist', async () => {
    const { push, gw, input, frame, update, unmount } = await mount();
    await push(snapshot([]));
    await input.pressEscape();
    await act(async () => {
      gw.dropConnection();
    });
    await update();
    const out = frame();
    expect(out).toContain('daemon disconnected — retrying…');
    expect(out).toContain(TAGLINE);
    unmount();
  });
});
