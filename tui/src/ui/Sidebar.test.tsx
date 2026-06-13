import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildQueue } from '../daemon/scoring';
import type { StatePush } from '../protocol';
import type { Session } from '../types';
import { Sidebar } from './Sidebar';
import { FakeGateway, renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-sb-'));
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
    harnesses: [{ id: 'claude', configured: true }],
    recentCwds: [],
  };
}

async function mount(sessionId = 'claude-1') {
  const gw = new FakeGateway();
  const quits: number[] = [];
  const el = await renderSetup(
    <Sidebar gateway={gw} onQuit={() => quits.push(1)} sessionId={sessionId} />,
    { width: 30, height: 40 },
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
const idle = () =>
  session({
    id: 'claude-2',
    status: 'idle',
    attentionReason: 'review / next prompt',
  });
const running = () => session({ id: 'codex-1', harness: 'codex' });
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

describe('Sidebar', () => {
  it('renders the header with the session id, SESSIONS, QUEUE, and reasons', async () => {
    const { push, frame, unmount } = await mount('claude-1');
    await push(snapshot([needsInput(), running()]));
    const out = frame();
    expect(out).toContain('holo');
    expect(out).toContain('claude-1');
    expect(out).toContain('SESSIONS');
    expect(out).toContain('QUEUE');
    expect(out).toContain('Clarify naming convention');
    unmount();
  });

  it('shows the bare empty hint, not the n-to-spawn one', async () => {
    const { push, frame, unmount } = await mount();
    await push(snapshot([]));
    const out = frame();
    expect(out).toContain('none');
    expect(out).not.toContain('n to spawn');
    unmount();
  });

  it('j/k move queue selection', async () => {
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

  it('enter sends a jump for the selected queue session', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    input.pressEnter();
    await update();
    expect(gw.requests).toContainEqual({ cmd: 'jump', sessionId: 'claude-1' });
    unmount();
  });

  it('a/d respond to a pending permission on the selected item only', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([withPermission(), running()]));
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

  it('q calls onQuit', async () => {
    const { push, input, quits, unmount } = await mount();
    await push(snapshot([needsInput()]));
    input.pressKey('q');
    expect(quits).toHaveLength(1);
    unmount();
  });

  it('n and tab produce no gateway requests', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    input.pressKey('n');
    input.pressTab();
    await update();
    expect(gw.requests).toHaveLength(0);
    unmount();
  });

  it('shows the retrying footer when disconnected and heals on reconnect', async () => {
    const { push, gw, frame, update, unmount } = await mount();
    await push(snapshot([needsInput()]));
    expect(frame()).not.toContain('retrying');
    const subsBefore = gw.subscribeCount;
    await act(async () => {
      gw.dropConnection();
    });
    await update();
    expect(frame()).toContain('retrying');
    // the hook re-subscribes after its 1s retry — wait that out, then push
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
    });
    expect(gw.subscribeCount).toBeGreaterThan(subsBefore);
    await push(snapshot([needsInput()]));
    expect(frame()).not.toContain('retrying');
    unmount();
  });
});
