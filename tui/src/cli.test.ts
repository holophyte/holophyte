/**
 * Unit tests for cli.ts — pure/injected logic, no real sockets or processes.
 */

import { homedir } from 'node:os';
import type { CliDeps } from './cli';
import { formatLs, helpText, makeEnsureDaemon, parseArgs, runCli } from './cli';
import { holoHome, tmuxSessionName } from './paths';
import type { Response } from './protocol';
import type { HarnessInfo, StateSnapshot } from './types';

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe('parseArgs', () => {
  it('no args → attach', () => {
    expect(parseArgs([])).toEqual({ kind: 'attach' });
  });

  it('--help → help', () => {
    expect(parseArgs(['--help'])).toEqual({ kind: 'help' });
  });

  it('-h → help', () => {
    expect(parseArgs(['-h'])).toEqual({ kind: 'help' });
  });

  it('help → help', () => {
    expect(parseArgs(['help'])).toEqual({ kind: 'help' });
  });

  it('tui → tui', () => {
    expect(parseArgs(['tui'])).toEqual({ kind: 'tui' });
  });

  it('daemon → daemon', () => {
    expect(parseArgs(['daemon'])).toEqual({ kind: 'daemon' });
  });

  it('new <harness>', () => {
    expect(parseArgs(['new', 'claude'])).toEqual({
      kind: 'new',
      harness: 'claude',
      cwd: undefined,
    });
  });

  it('new <harness> --cwd <path>', () => {
    expect(parseArgs(['new', 'codex', '--cwd', '/tmp/repo'])).toEqual({
      kind: 'new',
      harness: 'codex',
      cwd: '/tmp/repo',
    });
  });

  it('new with --cwd before extra args', () => {
    expect(parseArgs(['new', 'fake', '--cwd', '/some/path'])).toEqual({
      kind: 'new',
      harness: 'fake',
      cwd: '/some/path',
    });
  });

  it('next → next', () => {
    expect(parseArgs(['next'])).toEqual({ kind: 'next' });
  });

  it('ls → ls', () => {
    expect(parseArgs(['ls'])).toEqual({ kind: 'ls' });
  });

  it('setup → setup', () => {
    expect(parseArgs(['setup'])).toEqual({ kind: 'setup' });
  });

  it('unknown subcommand → unknown', () => {
    expect(parseArgs(['wat'])).toEqual({ kind: 'unknown', arg: 'wat' });
  });

  it('unknown subcommand with args → unknown (first arg only)', () => {
    expect(parseArgs(['foo', 'bar'])).toEqual({ kind: 'unknown', arg: 'foo' });
  });
});

// ---------------------------------------------------------------------------
// helpText
// ---------------------------------------------------------------------------

describe('helpText', () => {
  it('contains all main commands', () => {
    const text = helpText();
    expect(text).toContain('holo new');
    expect(text).toContain('holo next');
    expect(text).toContain('holo ls');
    expect(text).toContain('holo setup');
    expect(text).toContain('holo hook');
  });

  it('mentions harnesses', () => {
    const text = helpText();
    expect(text).toContain('claude');
    expect(text).toContain('codex');
  });

  it('mentions cold-start speed reason for hook', () => {
    const text = helpText();
    expect(text).toContain('cold-start');
  });
});

// ---------------------------------------------------------------------------
// formatLs
// ---------------------------------------------------------------------------

const NOW = 1_000_000_000;

function makeSnapshot(overrides: Partial<StateSnapshot> = {}): StateSnapshot {
  return {
    sessions: [],
    queue: [],
    harnesses: [],
    recentCwds: [],
    ...overrides,
  };
}

describe('formatLs', () => {
  it('empty → helpful message', () => {
    expect(formatLs(makeSnapshot(), NOW)).toBe(
      'no sessions — run: holo new <harness>',
    );
  });

  it('shows session id and status', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'claude-1',
          harness: 'claude',
          cwd: '/repo/a',
          tmuxWindow: '@1',
          status: 'running',
          createdAt: NOW,
          statusSince: NOW - 42_000,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('claude-1');
    expect(out).toContain('running');
  });

  it('formats elapsed time in seconds', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW - 30_000,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('30s');
  });

  it('formats elapsed in minutes', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW - 15 * 60_000,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('15m');
  });

  it('formats elapsed in hours', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW - 2 * 60 * 60_000,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('2h');
  });

  it('shows queue reason', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'claude-1',
          harness: 'claude',
          cwd: '/repo',
          tmuxWindow: '@1',
          status: 'permission',
          createdAt: NOW,
          statusSince: NOW - 5000,
          pendingPermission: {
            tool: 'Bash',
            input: {},
            respondBy: NOW + 10000,
          },
        },
      ],
      queue: [{ sessionId: 'claude-1', score: 100, reason: 'approve: Bash' }],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('approve: Bash');
  });

  it('uses attentionReason when no queue entry', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'claude-1',
          harness: 'claude',
          cwd: '/repo',
          tmuxWindow: '@1',
          status: 'needs_input',
          attentionReason: 'Clarify naming',
          createdAt: NOW,
          statusSince: NOW - 5000,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('Clarify naming');
  });

  it('shows - when no reason', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'running',
          createdAt: NOW,
          statusSince: NOW,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('-');
  });

  it('shortens home directory to ~', () => {
    const home = homedir();
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: `${home}/Development/repo`,
          tmuxWindow: '@1',
          status: 'running',
          createdAt: NOW,
          statusSince: NOW,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('~/Development/repo');
    expect(out).not.toContain(home + '/Development/repo');
  });

  it('footer shows session count and queued count', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      ],
      queue: [{ sessionId: 'fake-1', score: 30, reason: 'review' }],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('1 session');
    expect(out).toContain('1 queued');
  });

  it('footer uses plural for multiple sessions', () => {
    const state = makeSnapshot({
      sessions: [
        {
          id: 'fake-1',
          harness: 'fake',
          cwd: '/a',
          tmuxWindow: '@1',
          status: 'running',
          createdAt: NOW,
          statusSince: NOW,
        },
        {
          id: 'fake-2',
          harness: 'fake',
          cwd: '/b',
          tmuxWindow: '@2',
          status: 'running',
          createdAt: NOW,
          statusSince: NOW,
        },
      ],
    });
    const out = formatLs(state, NOW);
    expect(out).toContain('2 sessions');
  });
});

// ---------------------------------------------------------------------------
// runCli helpers
// ---------------------------------------------------------------------------

const HARNESSES: HarnessInfo[] = [
  { id: 'claude', configured: true },
  { id: 'codex', configured: true },
  { id: 'fake', configured: true },
  { id: 'cursor', configured: false },
  { id: 'devin', configured: false },
];

interface TestDeps extends CliDeps {
  stdoutLines: string[];
  stderrLines: string[];
  callCounts: { ensureDaemon: number };
}

function makeDeps(overrides: Partial<CliDeps> = {}): TestDeps {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const callCounts = { ensureDaemon: 0 };

  const base: Omit<CliDeps, keyof typeof overrides> = {
    request: async (_req) => ({ ok: true }) as Response,
    ensureDaemon: async () => {
      callCounts.ensureDaemon++;
    },
    tmux: {
      sessionExists: async () => false,
      ensureSession: async (_argv) => {},
      newWindow: async (_opts) => '@1',
      selectWindow: async (_id) => {},
      listWindowIds: async () => [],
      setStatusRight: async () => {},
      installReturnBinding: async () => {},
    },
    tuiArgv: ['bun', 'index.tsx', 'tui'],
    isInsideTmux: () => false,
    attachOrSwitch: () => 0,
    selectTuiWindow: async () => {},
    harnessInfos: async () => HARNESSES,
    now: () => NOW,
    stdout: (line) => stdoutLines.push(line),
    stderr: (line) => stderrLines.push(line),
  };

  const deps: CliDeps = { ...(base as CliDeps), ...overrides };

  return Object.assign(deps, { stdoutLines, stderrLines, callCounts });
}

// ---------------------------------------------------------------------------
// runCli — attach
// ---------------------------------------------------------------------------

describe('runCli attach', () => {
  it('calls ensureDaemon and ensureSession with the pane identity env', async () => {
    let ensureSessionArgv: string[] | null = null;
    let ensureSessionEnv: Record<string, string> | undefined;
    const deps = makeDeps({
      tmux: {
        sessionExists: async () => false,
        ensureSession: async (argv, env) => {
          ensureSessionArgv = argv;
          ensureSessionEnv = env;
        },
        newWindow: async () => '@1',
        selectWindow: async () => {},
        listWindowIds: async () => [],
        setStatusRight: async () => {},
        installReturnBinding: async () => {},
      },
    });
    const code = await runCli({ kind: 'attach' }, deps);
    expect(code).toBe(0);
    expect(deps.callCounts.ensureDaemon).toBe(1);
    expect(ensureSessionArgv).toEqual(deps.tuiArgv);
    expect(ensureSessionEnv).toEqual({
      HOLO_HOME: holoHome(),
      HOLO_TMUX_SESSION: tmuxSessionName(),
    });
  });

  it('inside tmux: calls attachOrSwitch then selectTuiWindow', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      isInsideTmux: () => true,
      attachOrSwitch: () => {
        calls.push('attach');
        return 0;
      },
      selectTuiWindow: async () => {
        calls.push('selectTui');
      },
    });
    const code = await runCli({ kind: 'attach' }, deps);
    expect(code).toBe(0);
    expect(calls).toEqual(['attach', 'selectTui']);
  });

  it('outside tmux: selects the tui window BEFORE attaching (attach blocks)', async () => {
    const calls: string[] = [];
    const deps = makeDeps({
      isInsideTmux: () => false,
      attachOrSwitch: () => {
        calls.push('attach');
        return 0;
      },
      selectTuiWindow: async () => {
        calls.push('selectTui');
      },
    });
    const code = await runCli({ kind: 'attach' }, deps);
    expect(code).toBe(0);
    expect(calls).toEqual(['selectTui', 'attach']);
  });
});

// ---------------------------------------------------------------------------
// runCli — new
// ---------------------------------------------------------------------------

describe('runCli new', () => {
  it('resolves cwd from process.cwd() when not provided', async () => {
    let requestedCwd: string | undefined;
    const deps = makeDeps({
      request: async (req) => {
        if (req.cmd === 'new') requestedCwd = req.cwd;
        return {
          ok: true,
          session: {
            id: 'fake-1',
            tmuxWindow: '@2',
            harness: 'fake',
            cwd: req.cwd ?? '',
            status: 'idle',
            createdAt: NOW,
            statusSince: NOW,
          },
        };
      },
    });
    await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(requestedCwd).toBe(process.cwd());
  });

  it('resolves relative cwd to absolute', async () => {
    let requestedCwd: string | undefined;
    const deps = makeDeps({
      request: async (req) => {
        if (req.cmd === 'new') requestedCwd = req.cwd;
        return {
          ok: true,
          session: {
            id: 'fake-1',
            tmuxWindow: '@2',
            harness: 'fake',
            cwd: req.cwd ?? '',
            status: 'idle',
            createdAt: NOW,
            statusSince: NOW,
          },
        };
      },
    });
    await runCli({ kind: 'new', harness: 'fake', cwd: 'subdir' }, deps);
    // Should be absolute
    expect(requestedCwd?.startsWith('/')).toBe(true);
  });

  it('returns exit 0 on success', async () => {
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'fake-1',
          tmuxWindow: '@2',
          harness: 'fake',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
    });
    const code = await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(code).toBe(0);
  });

  it('prints spawned message on success', async () => {
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'fake-1',
          tmuxWindow: '@2',
          harness: 'fake',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
    });
    await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(deps.stdoutLines.join(' ')).toContain('fake-1');
    expect(deps.stdoutLines.join(' ')).toContain('@2');
  });

  it('returns exit 1 on daemon error', async () => {
    const deps = makeDeps({
      request: async () => ({ ok: false, error: 'not configured' }),
    });
    const code = await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(code).toBe(1);
  });

  it('prints error to stderr on failure', async () => {
    const deps = makeDeps({
      request: async () => ({
        ok: false,
        error: 'harness not configured: fake',
      }),
    });
    await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(deps.stderrLines.join(' ')).toContain(
      'harness not configured: fake',
    );
  });

  it('outside tmux: calls attachOrSwitch on success', async () => {
    let attached = false;
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'fake-1',
          tmuxWindow: '@2',
          harness: 'fake',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
      isInsideTmux: () => false,
      attachOrSwitch: () => {
        attached = true;
        return 0;
      },
    });
    await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(attached).toBe(true);
  });

  it('inside tmux: does NOT call attachOrSwitch on success', async () => {
    let attached = false;
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'fake-1',
          tmuxWindow: '@2',
          harness: 'fake',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
      isInsideTmux: () => true,
      attachOrSwitch: () => {
        attached = true;
        return 0;
      },
    });
    await runCli({ kind: 'new', harness: 'fake' }, deps);
    expect(attached).toBe(false);
  });

  it('unknown harness → exit 1 with hint', async () => {
    const deps = makeDeps();
    const code = await runCli({ kind: 'new', harness: 'unknown-bot' }, deps);
    expect(code).toBe(1);
    expect(deps.stderrLines.join(' ')).toContain(
      'unknown harness: unknown-bot',
    );
    expect(deps.stderrLines.join(' ')).toContain('holo help');
  });
});

// ---------------------------------------------------------------------------
// runCli — next
// ---------------------------------------------------------------------------

describe('runCli next', () => {
  it('prints jumped message on success', async () => {
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'claude-1',
          tmuxWindow: '@1',
          harness: 'claude',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
    });
    const code = await runCli({ kind: 'next' }, deps);
    expect(code).toBe(0);
    expect(deps.stdoutLines.join(' ')).toContain('claude-1');
  });

  it('outside tmux: calls attachOrSwitch', async () => {
    let attached = false;
    const deps = makeDeps({
      request: async () => ({
        ok: true,
        session: {
          id: 'fake-1',
          tmuxWindow: '@1',
          harness: 'fake',
          cwd: '/a',
          status: 'idle',
          createdAt: NOW,
          statusSince: NOW,
        },
      }),
      isInsideTmux: () => false,
      attachOrSwitch: () => {
        attached = true;
        return 0;
      },
    });
    await runCli({ kind: 'next' }, deps);
    expect(attached).toBe(true);
  });

  it('queue empty (plain ok, no session) → exit 0 (not an error)', async () => {
    const deps = makeDeps({
      request: async () => ({ ok: true }),
    });
    const code = await runCli({ kind: 'next' }, deps);
    expect(code).toBe(0);
    expect(deps.stdoutLines.join(' ')).toContain('queue is empty');
    expect(deps.stderrLines).toEqual([]);
  });

  it('daemon error → stderr + exit 1', async () => {
    const deps = makeDeps({
      request: async () => ({ ok: false, error: 'spawn tmux ENOENT' }),
    });
    const code = await runCli({ kind: 'next' }, deps);
    expect(code).toBe(1);
    expect(deps.stderrLines.join(' ')).toContain('spawn tmux ENOENT');
    expect(deps.stdoutLines).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runCli — ls
// ---------------------------------------------------------------------------

describe('runCli ls', () => {
  it('calls request ls and prints output', async () => {
    let requested = false;
    const state: StateSnapshot = {
      sessions: [],
      queue: [],
      harnesses: [],
      recentCwds: [],
    };
    const deps = makeDeps({
      request: async (req) => {
        if (req.cmd === 'ls') requested = true;
        return { ok: true, state };
      },
    });
    const code = await runCli({ kind: 'ls' }, deps);
    expect(code).toBe(0);
    expect(requested).toBe(true);
    // empty state message
    expect(deps.stdoutLines.join(' ')).toContain('no sessions');
  });

  it('calls ensureDaemon', async () => {
    const state: StateSnapshot = {
      sessions: [],
      queue: [],
      harnesses: [],
      recentCwds: [],
    };
    const deps = makeDeps({
      request: async () => ({ ok: true, state }),
    });
    await runCli({ kind: 'ls' }, deps);
    expect(deps.callCounts.ensureDaemon).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// runCli — setup
// ---------------------------------------------------------------------------

describe('runCli setup', () => {
  it('prints harness table with configured status', async () => {
    const deps = makeDeps({
      tmux: {
        sessionExists: async () => false,
        ensureSession: async () => {},
        newWindow: async () => '@1',
        selectWindow: async () => {},
        listWindowIds: async () => [],
        setStatusRight: async () => {},
        installReturnBinding: async () => {},
      },
    });
    const code = await runCli({ kind: 'setup' }, deps);
    expect(code).toBe(0);
    const out = deps.stdoutLines.join('\n');
    expect(out).toContain('claude');
    expect(out).toContain('✓ configured');
    expect(out).toContain('cursor');
    expect(out).toContain('✗ not configured');
  });

  it('does NOT call ensureDaemon', async () => {
    const deps = makeDeps({
      tmux: {
        sessionExists: async () => false,
        ensureSession: async () => {},
        newWindow: async () => '@1',
        selectWindow: async () => {},
        listWindowIds: async () => [],
        setStatusRight: async () => {},
        installReturnBinding: async () => {},
      },
    });
    await runCli({ kind: 'setup' }, deps);
    expect(deps.callCounts.ensureDaemon).toBe(0);
  });

  it('reports tmux not running when installReturnBinding throws', async () => {
    const deps = makeDeps({
      tmux: {
        sessionExists: async () => false,
        ensureSession: async () => {},
        newWindow: async () => '@1',
        selectWindow: async () => {},
        listWindowIds: async () => [],
        setStatusRight: async () => {},
        installReturnBinding: async () => {
          throw new Error('no server');
        },
      },
    });
    await runCli({ kind: 'setup' }, deps);
    const out = deps.stdoutLines.join('\n');
    expect(out).toContain('tmux server not running');
  });
});

// ---------------------------------------------------------------------------
// runCli — unknown
// ---------------------------------------------------------------------------

describe('runCli unknown', () => {
  it('prints unknown command to stderr and returns exit 1', async () => {
    const deps = makeDeps();
    const code = await runCli({ kind: 'unknown', arg: 'foo' }, deps);
    expect(code).toBe(1);
    expect(deps.stderrLines.join(' ')).toContain('unknown command: foo');
  });

  it('prints help text', async () => {
    const deps = makeDeps();
    await runCli({ kind: 'unknown', arg: 'foo' }, deps);
    expect(deps.stdoutLines.join('\n')).toContain('holo new');
  });
});

// ---------------------------------------------------------------------------
// makeEnsureDaemon
// ---------------------------------------------------------------------------

describe('makeEnsureDaemon', () => {
  it('ping-ok short-circuits — no spawn', async () => {
    let spawned = false;
    const ensureDaemon = makeEnsureDaemon({
      spawnDetached: () => {
        spawned = true;
      },
      request: async () => ({ ok: true }),
      daemonArgv: ['bun', 'daemon'],
      pollIntervalMs: 10,
      timeoutMs: 100,
      pingBackoffMs: [1, 2, 4],
    });
    await ensureDaemon();
    expect(spawned).toBe(false);
  });

  it('a single failed ping never spawns — retried with backoff first', async () => {
    let spawned = false;
    let pings = 0;
    const ensureDaemon = makeEnsureDaemon({
      spawnDetached: () => {
        spawned = true;
      },
      request: async () => {
        pings++;
        // busy daemon misses the first two pings, answers the third
        if (pings < 3) throw new Error('daemon request timed out after 300ms');
        return { ok: true };
      },
      daemonArgv: ['bun', 'daemon'],
      pollIntervalMs: 10,
      timeoutMs: 100,
      pingBackoffMs: [1, 2, 4],
    });
    await ensureDaemon();
    expect(spawned).toBe(false);
    expect(pings).toBe(3);
  });

  it('all ping retries fail → spawn + polls until succeeds', async () => {
    const spawned = { value: false };
    let pingsBeforeSpawn = 0;
    const ensureDaemon = makeEnsureDaemon({
      spawnDetached: () => {
        spawned.value = true;
      },
      request: async () => {
        if (!spawned.value) {
          pingsBeforeSpawn++;
          throw new Error('ECONNREFUSED');
        }
        return { ok: true };
      },
      daemonArgv: ['bun', 'daemon'],
      pollIntervalMs: 10,
      timeoutMs: 1000,
      pingBackoffMs: [1, 2, 4],
    });
    await ensureDaemon();
    expect(spawned.value).toBe(true);
    expect(pingsBeforeSpawn).toBe(4); // initial ping + 3 backoff retries
  });

  it('never succeeds → throws', async () => {
    const ensureDaemon = makeEnsureDaemon({
      spawnDetached: () => {},
      request: async () => {
        throw new Error('ECONNREFUSED');
      },
      daemonArgv: ['bun', 'daemon'],
      pollIntervalMs: 5,
      timeoutMs: 30,
      pingBackoffMs: [1, 2, 4],
    });
    await expect(ensureDaemon()).rejects.toThrow('holod failed to start');
  }, 5000);
});
