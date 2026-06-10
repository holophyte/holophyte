import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildQueue } from '../daemon/scoring';
import type { Request, Response, StatePush } from '../protocol';
import type { Session } from '../types';
import { App } from './App';
import type { Gateway } from './gateway';
import { renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-ui-'));
});

class FakeGateway implements Gateway {
  requests: Request[] = [];
  nextResponse: Response = { ok: true };
  subscribeCount = 0;
  private handlers: { onState: (s: StatePush) => void; onClose?: () => void } | null = null;

  subscribe(handlers: { onState: (s: StatePush) => void; onClose?: () => void }) {
    this.subscribeCount += 1;
    this.handlers = handlers;
    return {
      close: () => {
        this.handlers = null;
      },
    };
  }

  async request(req: Request): Promise<Response> {
    this.requests.push(req);
    return this.nextResponse;
  }

  pushState(s: StatePush) {
    this.handlers?.onState(s);
  }

  dropConnection() {
    const handlers = this.handlers;
    this.handlers = null;
    handlers?.onClose?.();
  }
}

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
  session({ id: 'claude-1', status: 'needs_input', attentionReason: 'Clarify naming convention' });
const running = () =>
  session({ id: 'codex-1', harness: 'codex', cwd: '/Users/x/Development/holophyte' });
const idle = () =>
  session({ id: 'claude-2', status: 'idle', attentionReason: 'review / next prompt' });
const withPermission = () =>
  session({
    id: 'claude-1',
    status: 'permission',
    attentionReason: 'approve: Bash',
    pendingPermission: { tool: 'Bash', input: { command: 'rm -rf node_modules' }, respondBy: Date.now() + 30_000 },
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
    expect(gw.requests).toContainEqual({ cmd: 'respondPermission', sessionId: 'claude-1', allow: true });
    input.pressKey('d');
    await update();
    expect(gw.requests).toContainEqual({ cmd: 'respondPermission', sessionId: 'claude-1', allow: false });
    unmount();
  });

  it('a does nothing when the selected session has no pending permission', async () => {
    const { push, input, gw, update, unmount } = await mount();
    await push(snapshot([needsInput(), running()]));
    input.pressKey('a');
    await update();
    expect(gw.requests.filter((r) => r.cmd === 'respondPermission')).toHaveLength(0);
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
});
