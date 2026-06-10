/**
 * Integration tests for the daemon over a REAL unix socket: fresh HOLO_HOME
 * tmpdir per test, FakeTmux, in-test fake adapters, injected clock. The real
 * client.ts talks to the daemon exactly like the CLI/hooks/TUI do.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request, subscribe } from '../client';
import { writeJsonLine } from '../ndjson';
import { socketPath, statePath } from '../paths';
import type { Request, Response, StatePush } from '../protocol';
import { FakeTmux } from '../tmux';
import type {
  HarnessAdapter,
  HarnessId,
  HarnessInfo,
  Session,
  StateSnapshot,
} from '../types';
import { Daemon, type DaemonOptions } from './server';

const HARNESSES: HarnessInfo[] = [
  { id: 'claude', configured: true },
  { id: 'cursor', configured: false },
];

const TUI_ARGV = ['bun', '/holo/src/index.tsx', 'tui'];

// object wrapper so tests can mutate the injected clock
const clock = { now: 1_000_000_000 };

function fakeAdapter(
  id: HarnessId,
  opts: {
    configured?: boolean;
    spawn?: (session: Session) => string[] | Promise<string[]>;
  } = {},
): HarnessAdapter {
  return {
    id,
    spawnCommand: opts.spawn ?? (() => ['sleep', '999']),
    configured: () => opts.configured ?? true,
    capabilities: { remotePermission: true, questionText: true },
  };
}

function makeAdapters(
  overrides: Partial<Record<HarnessId, HarnessAdapter>> = {},
): Record<HarnessId, HarnessAdapter> {
  return {
    claude: fakeAdapter('claude'),
    codex: fakeAdapter('codex'),
    fake: fakeAdapter('fake'),
    cursor: fakeAdapter('cursor', { configured: false }),
    devin: fakeAdapter('devin', { configured: false }),
    ...overrides,
  };
}

let holoHomeDir: string;
const running: Daemon[] = [];

beforeEach(() => {
  holoHomeDir = mkdtempSync(join(tmpdir(), 'holo-'));
  process.env.HOLO_HOME = holoHomeDir;
  clock.now = 1_000_000_000;
});

afterEach(async () => {
  for (const daemon of running) await daemon.stop();
  running.length = 0;
  rmSync(holoHomeDir, { recursive: true, force: true });
  delete process.env.HOLO_HOME;
});

async function startDaemon(
  over: Partial<DaemonOptions> & { tmux?: FakeTmux } = {},
): Promise<{ daemon: Daemon; tmux: FakeTmux }> {
  const tmux = over.tmux ?? new FakeTmux();
  const daemon = new Daemon({
    adapters: makeAdapters(),
    harnesses: HARNESSES,
    tuiArgv: TUI_ARGV,
    now: () => clock.now,
    sweepIntervalMs: 3_600_000, // sweeps driven manually via sweepOnce()
    ...over,
    tmux,
  });
  await daemon.start();
  running.push(daemon);
  return { daemon, tmux };
}

async function ls(): Promise<StateSnapshot> {
  const res = await request({ cmd: 'ls' });
  if (!res.ok || !('state' in res)) {
    throw new Error(`ls failed: ${JSON.stringify(res)}`);
  }
  return res.state;
}

function newSession(harness: HarnessId = 'claude', cwd = '/repo/a') {
  return request({ cmd: 'new', harness, cwd });
}

function hook(sessionId: string, event: unknown): Promise<Response> {
  clock.now += 1000;
  return request({
    cmd: 'hook',
    sessionId,
    event,
    ts: clock.now,
  } as Request);
}

function find(
  state: StateSnapshot | StatePush | undefined,
  id: string,
): Session | undefined {
  return state?.sessions.find((s) => s.id === id);
}

async function status(id: string): Promise<string | undefined> {
  return find(await ls(), id)?.status;
}

function expectSession(res: Response): Session {
  if (!res.ok || !('session' in res)) {
    throw new Error(`expected session reply, got ${JSON.stringify(res)}`);
  }
  return res.session;
}

function expectError(res: Response): string {
  if (res.ok) throw new Error(`expected error, got ${JSON.stringify(res)}`);
  return res.error;
}

async function until(
  cond: () => boolean | Promise<boolean>,
  what = 'condition',
): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!(await cond())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('Daemon basics', () => {
  it('answers ping', async () => {
    await startDaemon();
    expect(await request({ cmd: 'ping' })).toEqual({ ok: true });
  });

  it('ls returns a full snapshot (harnesses + recentCwds present)', async () => {
    await startDaemon();
    const state = await ls();
    expect(state.sessions).toEqual([]);
    expect(state.queue).toEqual([]);
    expect(state.harnesses).toEqual(HARNESSES);
    expect(state.recentCwds).toEqual([]);
  });

  it('rejects unknown commands', async () => {
    await startDaemon();
    const res = await request({ cmd: 'wat' } as unknown as Request);
    expect(res).toEqual({ ok: false, error: 'unknown command' });
  });

  it('refuses to start when another daemon owns the socket', async () => {
    await startDaemon();
    const second = new Daemon({
      tmux: new FakeTmux(),
      adapters: makeAdapters(),
      harnesses: HARNESSES,
      tuiArgv: TUI_ARGV,
      now: () => clock.now,
      sweepIntervalMs: 3_600_000,
    });
    await expect(second.start()).rejects.toThrow('holod already running');
  });

  it('shutdown command stops the daemon and removes the socket', async () => {
    await startDaemon();
    expect(await request({ cmd: 'shutdown' })).toEqual({ ok: true });
    await until(() => !existsSync(socketPath()), 'socket removal');
  });
});

describe('subscribe', () => {
  it('pushes an immediate snapshot, then again on changes', async () => {
    await startDaemon();
    const pushes: StatePush[] = [];
    const sub = subscribe({ onState: (push) => pushes.push(push) });
    await until(() => pushes.length >= 1, 'initial push');
    expect(pushes[0]?.type).toBe('state');
    expect(pushes[0]?.harnesses).toEqual(HARNESSES);
    expect(pushes[0]?.sessions).toEqual([]);

    await newSession();
    await until(() => pushes.length >= 2, 'change push');
    const last = pushes[pushes.length - 1];
    expect(find(last, 'claude-1')?.status).toBe('idle');
    expect(last?.recentCwds).toEqual(['/repo/a']);
    sub.close();
  });
});

describe('new', () => {
  it('spawns a session: window created + selected, ensureSession with tuiArgv', async () => {
    const { tmux } = await startDaemon();
    const session = expectSession(await newSession('claude', '/repo/a'));
    expect(session.id).toBe('claude-1');
    expect(session.tmuxWindow).toBe('@1');
    expect(session.status).toBe('idle');
    expect(tmux.calls).toContainEqual({
      method: 'ensureSession',
      args: [TUI_ARGV],
    });
    expect(tmux.windows.get('@1')).toEqual({
      name: 'claude-1',
      cwd: '/repo/a',
      argv: ['sleep', '999'],
    });
    expect(tmux.selected).toBe('@1'); // jump-on-spawn
    expect(find(await ls(), 'claude-1')?.tmuxWindow).toBe('@1');
  });

  it('rejects an unconfigured harness', async () => {
    await startDaemon();
    const res = await newSession('cursor', '/repo/a');
    expect(expectError(res)).toMatch(/not configured/);
    expect((await ls()).sessions).toEqual([]);
  });

  it('rolls back the half-created session when the adapter throws', async () => {
    const { tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', {
          spawn: () => {
            throw new Error('boom');
          },
        }),
      }),
    });
    const res = await newSession('claude', '/repo/a');
    expect(expectError(res)).toMatch(/boom/);
    expect((await ls()).sessions).toEqual([]);
    expect(tmux.windows.size).toBe(0);
  });
});

describe('hook events', () => {
  it('drives ready/prompt/stop transitions, visible via pushes', async () => {
    await startDaemon();
    await newSession();
    const pushes: StatePush[] = [];
    const sub = subscribe({ onState: (push) => pushes.push(push) });
    await until(() => pushes.length >= 1, 'initial push');
    expect(find(pushes[pushes.length - 1], 'claude-1')?.status).toBe('idle');

    await hook('claude-1', { kind: 'prompt' });
    await until(
      () => find(pushes[pushes.length - 1], 'claude-1')?.status === 'running',
      'running push',
    );

    await hook('claude-1', { kind: 'ready' });
    await until(
      () => find(pushes[pushes.length - 1], 'claude-1')?.status === 'idle',
      'ready push',
    );
    expect(find(pushes[pushes.length - 1], 'claude-1')?.attentionReason).toBe(
      'awaiting first prompt',
    );

    await hook('claude-1', { kind: 'prompt' });
    await hook('claude-1', { kind: 'stop', lastMessage: 'done it' });
    await until(
      () => find(pushes[pushes.length - 1], 'claude-1')?.status === 'idle',
      'stop push',
    );
    const session = find(pushes[pushes.length - 1], 'claude-1');
    expect(session?.attentionReason).toBe('review / next prompt');
    expect(session?.lastMessage).toBe('done it');
    sub.close();
  });

  it('acks hooks for unknown sessions', async () => {
    await startDaemon();
    expect(await hook('ghost-9', { kind: 'prompt' })).toEqual({ ok: true });
  });
});

describe('permission flow', () => {
  it('end-to-end allow: held connection resolves via respondPermission', async () => {
    await startDaemon();
    await newSession();
    await hook('claude-1', { kind: 'prompt' });
    clock.now += 10;
    const held = request(
      {
        cmd: 'permission',
        sessionId: 'claude-1',
        tool: 'Bash',
        input: { command: 'rm -rf /' },
        timeoutMs: 5000,
        ts: clock.now,
      },
      { timeoutMs: 4000 },
    );
    await until(async () => (await status('claude-1')) === 'permission');
    const state = await ls();
    expect(find(state, 'claude-1')?.pendingPermission?.tool).toBe('Bash');
    expect(state.queue[0]?.sessionId).toBe('claude-1'); // permissions jump the queue

    const responder = await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    expect(responder).toEqual({ ok: true });
    expect(await held).toEqual({ ok: true, decision: 'allow' });
    expect(await status('claude-1')).toBe('running');
  });

  it('end-to-end deny', async () => {
    await startDaemon();
    await newSession();
    clock.now += 10;
    const held = request(
      {
        cmd: 'permission',
        sessionId: 'claude-1',
        tool: 'Edit',
        input: {},
        timeoutMs: 5000,
        ts: clock.now,
      },
      { timeoutMs: 4000 },
    );
    await until(async () => (await status('claude-1')) === 'permission');
    expect(
      await request({ cmd: 'respondPermission', sessionId: 'claude-1', allow: false }),
    ).toEqual({ ok: true });
    expect(await held).toEqual({ ok: true, decision: 'deny' });
    expect(await status('claude-1')).toBe('running');
  });

  it('hold timeout → decision timeout, session needs_input (in-pane reason)', async () => {
    await startDaemon();
    await newSession();
    clock.now += 10;
    const held = await request({
      cmd: 'permission',
      sessionId: 'claude-1',
      tool: 'Bash',
      input: null,
      timeoutMs: 100,
      ts: clock.now,
    });
    expect(held).toEqual({ ok: true, decision: 'timeout' });
    const session = find(await ls(), 'claude-1');
    expect(session?.status).toBe('needs_input');
    expect(session?.attentionReason).toBe('permission prompt in pane: Bash');
    expect(session?.pendingPermission).toBeUndefined();
  });

  it('permissionMaxHoldMs caps the client-requested hold', async () => {
    await startDaemon({ permissionMaxHoldMs: 80 });
    await newSession();
    clock.now += 10;
    const held = await request({
      cmd: 'permission',
      sessionId: 'claude-1',
      tool: 'Bash',
      input: null,
      timeoutMs: 600_000,
      ts: clock.now,
    });
    expect(held).toEqual({ ok: true, decision: 'timeout' });
  });

  it('unknown session → immediate timeout decision', async () => {
    await startDaemon();
    clock.now += 10;
    const res = await request({
      cmd: 'permission',
      sessionId: 'ghost-1',
      tool: 'Bash',
      input: null,
      timeoutMs: 5000,
      ts: clock.now,
    });
    expect(res).toEqual({ ok: true, decision: 'timeout' });
  });

  it('respondPermission with no hold → ok:false', async () => {
    await startDaemon();
    await newSession();
    const res = await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    expect(res).toEqual({
      ok: false,
      error: 'no pending permission for claude-1',
    });
  });

  it('a newer permission for the same session releases the old hold as timeout', async () => {
    await startDaemon();
    await newSession();
    clock.now += 10;
    const first = request(
      {
        cmd: 'permission',
        sessionId: 'claude-1',
        tool: 'Bash',
        input: 1,
        timeoutMs: 5000,
        ts: clock.now,
      },
      { timeoutMs: 4000 },
    );
    await until(async () => (await status('claude-1')) === 'permission');
    clock.now += 10;
    const second = request(
      {
        cmd: 'permission',
        sessionId: 'claude-1',
        tool: 'Edit',
        input: 2,
        timeoutMs: 5000,
        ts: clock.now,
      },
      { timeoutMs: 4000 },
    );
    expect(await first).toEqual({ ok: true, decision: 'timeout' });
    await until(
      async () => find(await ls(), 'claude-1')?.pendingPermission?.tool === 'Edit',
      'second hold',
    );
    await request({ cmd: 'respondPermission', sessionId: 'claude-1', allow: true });
    expect(await second).toEqual({ ok: true, decision: 'allow' });
  });

  it('held socket closing early resolves the permission as timeout', async () => {
    await startDaemon();
    await newSession();
    clock.now += 10;
    const raw = net.createConnection(socketPath());
    await new Promise<void>((resolve, reject) => {
      raw.once('connect', resolve);
      raw.once('error', reject);
    });
    writeJsonLine(raw, {
      cmd: 'permission',
      sessionId: 'claude-1',
      tool: 'Bash',
      input: null,
      timeoutMs: 5000,
      ts: clock.now,
    } satisfies Request);
    await until(async () => (await status('claude-1')) === 'permission');
    raw.destroy(); // agent killed mid-hold
    await until(async () => (await status('claude-1')) === 'needs_input');
    expect(find(await ls(), 'claude-1')?.attentionReason).toBe(
      'permission prompt in pane: Bash',
    );
  });
});

describe('next / jump', () => {
  it('next with empty queue → ok:false', async () => {
    await startDaemon();
    expect(await request({ cmd: 'next' })).toEqual({
      ok: false,
      error: 'queue is empty',
    });
  });

  it('next selects the top-scored session window', async () => {
    const { tmux } = await startDaemon();
    await newSession('claude', '/repo/a'); // claude-1 @1 (idle, 30)
    await newSession('claude', '/repo/b'); // claude-2 @2 (idle, 30) — selected
    await hook('claude-1', { kind: 'notification', reason: 'Approve plan' }); // 60
    const session = expectSession(await request({ cmd: 'next' }));
    expect(session.id).toBe('claude-1');
    expect(tmux.selected).toBe('@1');
  });

  it('jump selects a specific session window; unknown session → ok:false', async () => {
    const { tmux } = await startDaemon();
    await newSession('claude', '/repo/a');
    await newSession('claude', '/repo/b');
    const session = expectSession(
      await request({ cmd: 'jump', sessionId: 'claude-1' }),
    );
    expect(session.id).toBe('claude-1');
    expect(tmux.selected).toBe('@1');
    expect(
      expectError(await request({ cmd: 'jump', sessionId: 'nope-1' })),
    ).toMatch(/unknown session/);
  });
});

describe('sweep', () => {
  it('marks sessions with dead windows exited, then prunes after grace', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    tmux.closeWindow('@1');
    await daemon.sweepOnce();
    const session = find(await ls(), 'claude-1');
    expect(session?.status).toBe('exited');
    expect(session?.attentionReason).toBe('window closed');
    expect((await ls()).queue).toEqual([]); // exited never queues

    clock.now += 61_000;
    await daemon.sweepOnce();
    expect(find(await ls(), 'claude-1')).toBeUndefined();
  });
});

describe('restart persistence', () => {
  it('restores sessions and continues counters across daemon restarts', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession('claude', '/repo/a');
    await daemon.stop();
    expect(existsSync(statePath())).toBe(true);
    expect(existsSync(socketPath())).toBe(false);

    // same FakeTmux → window @1 still "alive", session survives reconcile
    await startDaemon({ tmux });
    const state = await ls();
    expect(find(state, 'claude-1')?.status).toBe('idle');
    expect(state.recentCwds).toEqual(['/repo/a']);
    const session = expectSession(await newSession('claude', '/repo/b'));
    expect(session.id).toBe('claude-2'); // counter never reused
  });
});
