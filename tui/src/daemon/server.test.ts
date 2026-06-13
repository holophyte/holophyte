/**
 * Integration tests for the daemon over a REAL unix socket: fresh HOLO_HOME
 * tmpdir per test, FakeTmux, in-test fake adapters, injected clock. The real
 * client.ts talks to the daemon exactly like the CLI/hooks/TUI do.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
import { EXITED_GRACE_MS } from './registry';
import { Daemon, type DaemonOptions } from './server';
import { STATUS_STOPPED_LINE } from './status-line';

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
    resume?: (session: Session) => string[] | Promise<string[]>;
  } = {},
): HarnessAdapter {
  return {
    id,
    spawnCommand: opts.spawn ?? (() => ['sleep', '999']),
    // wired only when provided — adapters without it exercise the
    // cannot-resume path
    ...(opts.resume ? { resumeCommand: opts.resume } : {}),
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

  it('refuses to start even when the live daemon never replies', async () => {
    // a listener that accepts connections but answers nothing — what a live
    // daemon looks like when its event loop is starved under load. Connect
    // success alone must count as live, or the socket gets stolen.
    const silent = net.createServer();
    await new Promise<void>((resolve) => silent.listen(socketPath(), resolve));
    try {
      const second = new Daemon({
        tmux: new FakeTmux(),
        adapters: makeAdapters(),
        harnesses: HARNESSES,
        tuiArgv: TUI_ARGV,
        now: () => clock.now,
        sweepIntervalMs: 3_600_000,
      });
      await expect(second.start()).rejects.toThrow('holod already running');
      expect(existsSync(socketPath())).toBe(true);
    } finally {
      await new Promise((resolve) => silent.close(resolve));
    }
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
    const env = { HOLO_HOME: holoHomeDir, HOLO_TMUX_SESSION: 'holo' };
    const session = expectSession(await newSession('claude', '/repo/a'));
    expect(session.id).toBe('claude-1');
    expect(session.tmuxWindow).toBe('@1');
    expect(session.status).toBe('idle');
    expect(tmux.calls).toContainEqual({
      method: 'ensureSession',
      args: [TUI_ARGV, env],
    });
    expect(tmux.windows.get('@1')).toEqual({
      name: 'claude-1',
      cwd: '/repo/a',
      argv: ['sleep', '999'],
      env,
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

describe('resume', () => {
  const resumeArgv = (s: Session) => [
    'resume-bin',
    s.harnessSessionId ?? '',
    s.id,
  ];

  /** Spawn claude-1, capture conv-1 via ready, kill its window → exited. */
  async function exitedSession(
    daemon: Daemon,
    tmux: FakeTmux,
    opts: { ready?: unknown } = {},
  ): Promise<void> {
    await newSession('claude', '/repo/a');
    await hook(
      'claude-1',
      opts.ready ?? { kind: 'ready', harnessSessionId: 'conv-1' },
    );
    tmux.closeWindow('@1');
    await daemon.sweepOnce();
    await daemon.sweepOnce(); // two-strike termination
    expect(await status('claude-1')).toBe('exited');
  }

  it('mints a fresh session that continues the conversation, drops the old record', async () => {
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', { resume: resumeArgv }),
      }),
    });
    await newSession('claude', '/repo/a');
    await hook('claude-1', { kind: 'ready', harnessSessionId: 'conv-1' });
    await hook('claude-1', { kind: 'stop', lastMessage: 'prior tail' });
    tmux.closeWindow('@1');
    await daemon.sweepOnce();
    await daemon.sweepOnce();
    expect(await status('claude-1')).toBe('exited');

    const session = expectSession(
      await request({ cmd: 'resume', sessionId: 'claude-1' }),
    );
    expect(session.id).toBe('claude-2');
    expect(session.status).toBe('idle');
    expect(session.harnessSessionId).toBe('conv-1');
    expect(session.lastMessage).toBe('prior tail'); // preview shows the prior tail while booting
    expect(session.tmuxWindow).toBe('@2');
    const env = { HOLO_HOME: holoHomeDir, HOLO_TMUX_SESSION: 'holo' };
    expect(tmux.windows.get('@2')).toEqual({
      name: 'claude-2',
      cwd: '/repo/a',
      argv: ['resume-bin', 'conv-1', 'claude-2'],
      env,
    });
    expect(tmux.selected).toBe('@2'); // jump-on-spawn
    const state = await ls();
    expect(find(state, 'claude-1')).toBeUndefined();
    expect(state.sessions).toHaveLength(1);
  });

  it('unknown session → ok:false, nothing spawned', async () => {
    const { tmux } = await startDaemon();
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'ghost-1' })),
    ).toMatch(/unknown session/);
    expect((await ls()).sessions).toEqual([]);
    expect(tmux.windows.size).toBe(0);
  });

  it('non-exited session → ok:false, nothing spawned', async () => {
    const { tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', { resume: resumeArgv }),
      }),
    });
    await newSession('claude', '/repo/a');
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'claude-1' })),
    ).toMatch(/not exited/);
    expect((await ls()).sessions).toHaveLength(1);
    expect(tmux.windows.size).toBe(1);
  });

  it('adapter without resumeCommand → ok:false, nothing spawned', async () => {
    const { daemon, tmux } = await startDaemon(); // default fakeAdapter: no resume
    await exitedSession(daemon, tmux);
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'claude-1' })),
    ).toMatch(/cannot resume/);
    expect((await ls()).sessions).toHaveLength(1);
    expect(tmux.windows.size).toBe(0);
  });

  it('unconfigured harness with resume support → ok:false, nothing spawned', async () => {
    const state = { configured: true };
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: {
          id: 'claude',
          spawnCommand: () => ['sleep', '999'],
          resumeCommand: resumeArgv,
          configured: () => state.configured,
          capabilities: { remotePermission: true, questionText: true },
        },
      }),
    });
    await exitedSession(daemon, tmux);
    state.configured = false; // uninstalled while exited
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'claude-1' })),
    ).toMatch(/not configured/);
    expect((await ls()).sessions).toHaveLength(1);
    expect(tmux.windows.size).toBe(0);
  });

  it('exited session that never reported a conversation id → ok:false', async () => {
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', { resume: resumeArgv }),
      }),
    });
    await exitedSession(daemon, tmux, { ready: { kind: 'ready' } });
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'claude-1' })),
    ).toMatch(/no conversation id/);
    expect((await ls()).sessions).toHaveLength(1);
    expect(tmux.windows.size).toBe(0);
  });

  it('a throwing resumeCommand rolls back the new session and spares every exited one', async () => {
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', {
          resume: () => {
            throw new Error('resume boom');
          },
        }),
      }),
    });
    await newSession('claude', '/repo/a'); // claude-1 @1
    await newSession('claude', '/repo/b'); // claude-2 @2
    await hook('claude-1', { kind: 'ready', harnessSessionId: 'conv-1' });
    await hook('claude-2', { kind: 'ready', harnessSessionId: 'conv-2' });
    tmux.closeWindow('@1');
    tmux.closeWindow('@2');
    await daemon.sweepOnce();
    await daemon.sweepOnce();
    expect(await status('claude-1')).toBe('exited');
    expect(await status('claude-2')).toBe('exited');

    const res = await request({ cmd: 'resume', sessionId: 'claude-1' });
    expect(expectError(res)).toMatch(/resume boom/);
    // the old removeSession pruned ALL exited sessions with zero grace —
    // both records surviving is the regression guard
    const state = await ls();
    expect(find(state, 'claude-1')?.status).toBe('exited');
    expect(find(state, 'claude-2')?.status).toBe('exited');
    expect(state.sessions).toHaveLength(2); // no half-created claude-3
    expect(tmux.windows.size).toBe(0);
  });

  it('selectWindow failure after the spawn is non-fatal', async () => {
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', { resume: resumeArgv }),
      }),
    });
    await exitedSession(daemon, tmux);
    const orig = tmux.selectWindow.bind(tmux);
    tmux.selectWindow = async () => {
      tmux.selectWindow = orig; // throw once
      throw new Error('select boom');
    };
    const session = expectSession(
      await request({ cmd: 'resume', sessionId: 'claude-1' }),
    );
    expect(session.id).toBe('claude-2');
    const state = await ls();
    expect(find(state, 'claude-2')).toBeDefined();
    expect(find(state, 'claude-1')).toBeUndefined();
  });

  it('a second resume while one is in flight is rejected', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = { value: false };
    const { daemon, tmux } = await startDaemon({
      adapters: makeAdapters({
        claude: fakeAdapter('claude', {
          resume: async (s) => {
            entered.value = true;
            await gate;
            return resumeArgv(s);
          },
        }),
      }),
    });
    await exitedSession(daemon, tmux);

    const first = request({ cmd: 'resume', sessionId: 'claude-1' });
    await until(() => entered.value, 'first resume in flight');
    expect(
      expectError(await request({ cmd: 'resume', sessionId: 'claude-1' })),
    ).toMatch(/in flight/);
    release();
    expect(expectSession(await first).id).toBe('claude-2');
  });

  it('captured conversation ids survive a daemon restart', async () => {
    const adapters = () =>
      makeAdapters({
        claude: fakeAdapter('claude', { resume: resumeArgv }),
      });
    const { daemon, tmux } = await startDaemon({ adapters: adapters() });
    await newSession('claude', '/repo/a');
    await hook('claude-1', { kind: 'ready', harnessSessionId: 'conv-1' });
    await daemon.stop();

    const second = await startDaemon({ tmux, adapters: adapters() });
    tmux.closeWindow('@1');
    await second.daemon.sweepOnce();
    await second.daemon.sweepOnce();
    const session = expectSession(
      await request({ cmd: 'resume', sessionId: 'claude-1' }),
    );
    expect(session.harnessSessionId).toBe('conv-1');
    expect(tmux.windows.get('@2')?.argv).toEqual([
      'resume-bin',
      'conv-1',
      'claude-2',
    ]);
  });

  it('exited sessions outlive the old 60s horizon and prune after the grace', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession('claude', '/repo/a');
    tmux.closeWindow('@1');
    await daemon.sweepOnce();
    await daemon.sweepOnce();
    expect(await status('claude-1')).toBe('exited');

    clock.now += 61_000; // pre-feature grace — must no longer prune
    await daemon.sweepOnce();
    expect(await status('claude-1')).toBe('exited');

    clock.now += EXITED_GRACE_MS;
    await daemon.sweepOnce();
    expect(find(await ls(), 'claude-1')).toBeUndefined();
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
      await request({
        cmd: 'respondPermission',
        sessionId: 'claude-1',
        allow: false,
      }),
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

  /** First permission (Bash) held; second (Edit) arrives while it is. */
  async function overlappingPermissions() {
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
    const second = await request({
      cmd: 'permission',
      sessionId: 'claude-1',
      tool: 'Edit',
      input: 2,
      timeoutMs: 5000,
      ts: clock.now,
    });
    return { first, second };
  }

  it('a second permission gets an immediate timeout while the first stays held and answerable', async () => {
    await startDaemon();
    const { first, second } = await overlappingPermissions();
    // newer hook degrades to the in-pane dialog; the original hold is untouched
    expect(second).toEqual({ ok: true, decision: 'timeout' });
    expect(find(await ls(), 'claude-1')?.pendingPermission?.tool).toBe('Bash');
    await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    expect(await first).toEqual({ ok: true, decision: 'allow' });
  });

  it('resolving the held permission lands on needs_input — the pane is blocked on the second dialog', async () => {
    await startDaemon();
    const { first } = await overlappingPermissions();
    // the Notification fired by the in-pane dialog is masked (status is
    // 'permission') but must NOT erase the outstanding-dialog marker
    await hook('claude-1', {
      kind: 'notification',
      reason: 'permission prompt',
    });
    await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    expect(await first).toEqual({ ok: true, decision: 'allow' });
    const state = await ls();
    const session = find(state, 'claude-1');
    expect(session?.status).toBe('needs_input');
    expect(session?.attentionReason).toBe('permission prompt in pane: Edit');
    expect(state.queue[0]?.sessionId).toBe('claude-1'); // visible, not stuck running
  });

  it('a later lifecycle event clears the pane-dialog state back to running', async () => {
    await startDaemon();
    const { first } = await overlappingPermissions();
    await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    await first;
    await hook('claude-1', { kind: 'tool' }); // dialog answered — the turn resumed
    const session = find(await ls(), 'claude-1');
    expect(session?.status).toBe('running');
    expect(session?.attentionReason).toBeUndefined();
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
  it('next with empty queue → plain ok, no session', async () => {
    await startDaemon();
    expect(await request({ cmd: 'next' })).toEqual({ ok: true });
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
  it('marks sessions exited after two missing sweeps, then prunes after grace', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    tmux.closeWindow('@1');
    await daemon.sweepOnce();
    // first miss — could be a transient bad list-windows sample
    expect(find(await ls(), 'claude-1')?.status).toBe('idle');

    await daemon.sweepOnce();
    const session = find(await ls(), 'claude-1');
    expect(session?.status).toBe('exited');
    expect(session?.attentionReason).toBe('window closed');
    expect((await ls()).queue).toEqual([]); // exited never queues

    clock.now += EXITED_GRACE_MS + 1_000;
    await daemon.sweepOnce();
    expect(find(await ls(), 'claude-1')).toBeUndefined();
  });

  it('a window reappearing after one missed sweep resets the strike', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    const window = tmux.windows.get('@1');
    if (!window) throw new Error('expected window @1');
    tmux.closeWindow('@1');
    await daemon.sweepOnce(); // strike one
    tmux.windows.set('@1', window); // tmux answered again
    await daemon.sweepOnce(); // strike cleared
    tmux.closeWindow('@1');
    await daemon.sweepOnce(); // strike one again — still live
    expect(find(await ls(), 'claude-1')?.status).toBe('idle');
    await daemon.sweepOnce();
    expect(find(await ls(), 'claude-1')?.status).toBe('exited');
  });

  it('a rejecting listWindowIds skips the tick without touching sessions', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    tmux.listWindowIds = async () => {
      throw new Error('spawn tmux EAGAIN');
    };
    await expect(daemon.sweepOnce()).rejects.toThrow('EAGAIN');
    expect(find(await ls(), 'claude-1')?.status).toBe('idle');
  });

  it('re-broadcasts when aging changes scores with no registry change', async () => {
    const { daemon } = await startDaemon();
    await newSession(); // idle — base score 30
    const pushes: StatePush[] = [];
    const sub = subscribe({ onState: (push) => pushes.push(push) });
    await until(() => pushes.length >= 1, 'initial push');
    expect(pushes[pushes.length - 1]?.queue[0]?.score).toBe(30);

    clock.now += 61_000; // one full minute → +2 aging bonus
    await daemon.sweepOnce();
    await until(() => pushes.length >= 2, 'aging push');
    expect(pushes[pushes.length - 1]?.queue[0]?.score).toBe(32);

    // same minute — queue identical, no extra push
    const count = pushes.length;
    await daemon.sweepOnce();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(pushes.length).toBe(count);
    sub.close();
  });

  it('re-probes harness configured flags and broadcasts changes', async () => {
    const cursorState = { configured: false };
    const { daemon } = await startDaemon({
      adapters: makeAdapters({
        cursor: {
          id: 'cursor',
          spawnCommand: () => ['sleep', '999'],
          configured: () => cursorState.configured,
          capabilities: { remotePermission: true, questionText: true },
        },
      }),
    });
    expect((await ls()).harnesses).toEqual(HARNESSES);
    const pushes: StatePush[] = [];
    const sub = subscribe({ onState: (push) => pushes.push(push) });
    await until(() => pushes.length >= 1, 'initial push');

    cursorState.configured = true; // "installed" while holod runs
    await daemon.sweepOnce();
    await until(() => pushes.length >= 2, 'harness push');
    const fresh = [
      { id: 'claude', configured: true },
      { id: 'cursor', configured: true },
    ];
    expect(pushes[pushes.length - 1]?.harnesses).toEqual(fresh);
    expect((await ls()).harnesses).toEqual(fresh);
    sub.close();
  });
});

describe('socket takeover defense', () => {
  it('recovers from a stale socket file left by a crashed daemon', async () => {
    writeFileSync(socketPath(), ''); // crash leaves the path occupied
    await startDaemon();
    expect(await request({ cmd: 'ping' })).toEqual({ ok: true });
  });

  it('stops itself when its socket file disappears, without clobbering state', async () => {
    const { daemon } = await startDaemon();
    await newSession();
    unlinkSync(socketPath()); // another daemon took the path over
    const takeoverState =
      '{"sessions":[],"counters":{},"recentCwds":["/theirs"]}';
    writeFileSync(statePath(), takeoverState);
    await daemon.sweepOnce();
    await expect(
      request({ cmd: 'ping' }, { timeoutMs: 250 }),
    ).rejects.toThrow();
    // the new owner's state file was not overwritten by our shutdown persist
    expect(readFileSync(statePath(), 'utf8')).toBe(takeoverState);
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

describe('status line', () => {
  const NO_SESSIONS_LINE =
    '#[fg=#4EA876,bold]holo#[default] #[dim]no sessions#[default]';

  function statusCalls(tmux: FakeTmux) {
    return tmux.calls.filter((call) => call.method === 'setStatusRight');
  }

  it('asserts the line on daemon start', async () => {
    const { tmux } = await startDaemon();
    await until(() => tmux.statusRight !== null, 'initial status line');
    expect(tmux.statusRight).toBe(NO_SESSIONS_LINE);
  });

  it('updates on spawn with the top queue item', async () => {
    const { tmux } = await startDaemon();
    await newSession();
    await until(
      () => tmux.statusRight?.includes('1 idle') === true,
      'spawn status line',
    );
    expect(tmux.statusRight).toContain('claude-1');
    expect(tmux.statusRight).toContain('starting…');
  });

  it('shows permission counts, then releases back to running', async () => {
    const { tmux } = await startDaemon();
    await newSession();
    await hook('claude-1', { kind: 'prompt' });
    clock.now += 10;
    const held = request(
      {
        cmd: 'permission',
        sessionId: 'claude-1',
        tool: 'Bash',
        input: null,
        timeoutMs: 5000,
        ts: clock.now,
      },
      { timeoutMs: 4000 },
    );
    await until(async () => (await status('claude-1')) === 'permission');
    await until(
      () => tmux.statusRight?.includes('1 perm') === true,
      'permission status line',
    );
    expect(tmux.statusRight).toContain('#[fg=yellow,bold]1 perm#[default]');
    expect(tmux.statusRight).toContain('approve: Bash');

    await request({
      cmd: 'respondPermission',
      sessionId: 'claude-1',
      allow: true,
    });
    expect(await held).toEqual({ ok: true, decision: 'allow' });
    await until(
      () =>
        tmux.statusRight?.includes('1 run') === true &&
        tmux.statusRight.includes('nothing needs you'),
      'released status line',
    );
  });

  it('dedupes byte-identical renders between sweeps', async () => {
    const { tmux } = await startDaemon();
    await newSession();
    await hook('claude-1', { kind: 'prompt' });
    await hook('claude-1', { kind: 'stop', lastMessage: 'a' });
    await until(
      () => tmux.statusRight?.includes('review / next prompt') === true,
      'idle status line',
    );
    const count = statusCalls(tmux).length;
    // lastMessage changes → registry change + broadcast, render identical
    await hook('claude-1', { kind: 'stop', lastMessage: 'b' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(statusCalls(tmux).length).toBe(count);
  });

  it('re-asserts the identical line once per sweep', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    await until(
      () => tmux.statusRight?.includes('claude-1') === true,
      'spawn status line',
    );
    const before = statusCalls(tmux);
    const last = before[before.length - 1];
    await daemon.sweepOnce();
    await until(
      () => statusCalls(tmux).length === before.length + 1,
      're-assert call',
    );
    expect(statusCalls(tmux)[before.length]).toEqual(last);
  });

  it('keeps serving when setStatusRight rejects and heals on the next sweep', async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    await until(
      () => tmux.statusRight?.includes('claude-1') === true,
      'spawn status line',
    );
    const orig = tmux.setStatusRight.bind(tmux);
    tmux.setStatusRight = async () => {
      throw new Error('boom');
    };
    expect(await hook('claude-1', { kind: 'prompt' })).toEqual({ ok: true });
    await daemon.sweepOnce();
    expect(await request({ cmd: 'ping' })).toEqual({ ok: true });
    expect(tmux.statusRight).toContain('starting…'); // stale while tmux is down

    tmux.setStatusRight = orig;
    await daemon.sweepOnce();
    await until(
      () => tmux.statusRight?.includes('1 run') === true,
      'healed status line',
    );
  });

  it('writes the stopped tombstone on graceful stop', async () => {
    const { daemon, tmux } = await startDaemon();
    await until(() => tmux.statusRight !== null, 'initial status line');
    await daemon.stop();
    expect(tmux.statusRight).toBe(STATUS_STOPPED_LINE);
  });

  it('a spawn resuming after stop() cannot overwrite the tombstone', async () => {
    const { daemon, tmux } = await startDaemon();
    // hold the spawn mid-flight so its broadcast resumes after stop()
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const origNewWindow = tmux.newWindow.bind(tmux);
    tmux.newWindow = async (opts) => {
      const id = await origNewWindow(opts);
      await gate;
      return id;
    };
    const pending = newSession().catch(() => {}); // stop() drops the connection
    await until(() => tmux.windows.size === 1, 'window creation');
    await daemon.stop();
    expect(tmux.statusRight).toBe(STATUS_STOPPED_LINE);

    release(); // the spawn's persist/broadcast now runs after the tombstone
    await pending;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(tmux.statusRight).toBe(STATUS_STOPPED_LINE);
  });

  it('stop() resolves even when the tombstone write hangs', async () => {
    const { daemon, tmux } = await startDaemon();
    // wedged tmux: the write never settles — the deadline must unblock stop()
    tmux.setStatusRight = () => new Promise<void>(() => {});
    await daemon.stop();
  });

  it('a failed write un-latches so the next broadcast retries before the sweep', async () => {
    const { tmux } = await startDaemon();
    await newSession('claude', '/repo/a');
    await newSession('claude', '/repo/b');
    await hook('claude-1', { kind: 'prompt' });
    clock.now += 10;
    await hook('claude-1', { kind: 'stop', lastMessage: 'x' });
    clock.now += 10;
    await hook('claude-2', { kind: 'prompt' });
    clock.now += 10;
    await until(
      () => tmux.statusRight?.includes('1 run 1 idle') === true,
      'mixed status line',
    );
    // next write fails at the spawn level (tmux could not be asked)
    const original = tmux.setStatusRight.bind(tmux);
    tmux.setStatusRight = async () => {
      tmux.setStatusRight = original;
      throw new Error('boom');
    };
    await hook('claude-2', { kind: 'stop', lastMessage: 'a' }); // "2 idle" render fails
    await until(
      () => tmux.setStatusRight === original,
      'failed write attempted',
    );
    clock.now += 10;
    // byte-identical render (only lastMessage changed) must retry, not dedupe
    await hook('claude-2', { kind: 'stop', lastMessage: 'b' });
    await until(
      () => tmux.statusRight?.includes('2 idle') === true,
      'retried status line',
    );
  });

  it("never touches the new owner's line after a takeover", async () => {
    const { daemon, tmux } = await startDaemon();
    await newSession();
    await until(
      () => tmux.statusRight?.includes('claude-1') === true,
      'spawn status line',
    );
    const before = tmux.statusRight;
    unlinkSync(socketPath()); // another daemon took the path over
    writeFileSync(statePath(), '{"sessions":[],"counters":{},"recentCwds":[]}');
    await daemon.sweepOnce();
    await expect(
      request({ cmd: 'ping' }, { timeoutMs: 250 }),
    ).rejects.toThrow();
    expect(tmux.statusRight).toBe(before);
    expect(tmux.calls).not.toContainEqual({
      method: 'setStatusRight',
      args: [STATUS_STOPPED_LINE],
    });
  });
});
