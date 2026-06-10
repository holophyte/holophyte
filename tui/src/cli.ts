/**
 * CLI logic for `holo` — all dependency-injected so the pure logic is unit-testable
 * without spawning processes, touching sockets, or calling tmux.
 *
 * `holo hook` is NOT a CLI subcommand: injected hooks invoke src/hook/main.ts
 * directly for cold-start speed. It appears only in the help epilog.
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { holoHome, returnBindingKey } from './paths';
import type { request } from './client';
import type { HarnessId, HarnessInfo, StateSnapshot } from './types';
import type { Tmux } from './tmux';

// ---------------------------------------------------------------------------
// Command types
// ---------------------------------------------------------------------------

export type CliCommand =
  | { kind: 'attach' }
  | { kind: 'tui' }
  | { kind: 'daemon' }
  | { kind: 'new'; harness: string; cwd?: string }
  | { kind: 'next' }
  | { kind: 'ls' }
  | { kind: 'setup' }
  | { kind: 'help' }
  | { kind: 'unknown'; arg: string };

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

export function parseArgs(argv: string[]): CliCommand {
  const [first, second, ...rest] = argv;

  if (!first || first === '--help' || first === '-h') {
    return first === undefined ? { kind: 'attach' } : { kind: 'help' };
  }

  switch (first) {
    case 'tui':
      return { kind: 'tui' };
    case 'daemon':
      return { kind: 'daemon' };
    case 'new': {
      if (!second) return { kind: 'help' };
      let cwd: string | undefined;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '--cwd' && rest[i + 1]) {
          cwd = rest[i + 1];
          i++;
        }
      }
      return { kind: 'new', harness: second, cwd };
    }
    case 'next':
      return { kind: 'next' };
    case 'ls':
      return { kind: 'ls' };
    case 'setup':
      return { kind: 'setup' };
    case 'help':
      return { kind: 'help' };
    default:
      return { kind: 'unknown', arg: first };
  }
}

// ---------------------------------------------------------------------------
// helpText
// ---------------------------------------------------------------------------

export function helpText(): string {
  return `holo — attention queue for parallel coding-agent sessions

Usage:
  holo                            attach/start tmux session + TUI
  holo new <harness> [--cwd <path>]  spawn a new agent session
  holo next                       jump to top queue item
  holo ls                         list sessions (plain text)
  holo setup                      check configuration, install tmux binding

Harnesses: claude, codex, cursor, devin, fake

Options:
  -h, --help    show this help

Note: \`holo hook\` is NOT a CLI subcommand — injected hooks invoke
src/hook/main.ts directly for cold-start speed.
`;
}

// ---------------------------------------------------------------------------
// formatLs — exported pure function for testing
// ---------------------------------------------------------------------------

function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

function shortenHome(p: string): string {
  const home = homedir();
  return p.startsWith(home + '/') || p === home ? '~' + p.slice(home.length) : p;
}

export function formatLs(state: StateSnapshot, now: number): string {
  if (state.sessions.length === 0) {
    return 'no sessions — run: holo new <harness>';
  }

  const rows = state.sessions.map((s) => {
    const age = fmtElapsed(now - s.statusSince);
    const qItem = state.queue.find((q) => q.sessionId === s.id);
    const reason = s.attentionReason ?? qItem?.reason ?? '-';
    const cwd = shortenHome(s.cwd);
    return { id: s.id, status: s.status, age, reason, cwd };
  });

  // Column widths
  const idW = Math.max(4, ...rows.map((r) => r.id.length));
  const stW = Math.max(6, ...rows.map((r) => r.status.length));
  const ageW = Math.max(3, ...rows.map((r) => r.age.length));
  const reasonW = Math.max(6, ...rows.map((r) => r.reason.length));

  const header = [
    'ID'.padEnd(idW),
    'STATUS'.padEnd(stW),
    'AGE'.padEnd(ageW),
    'REASON'.padEnd(reasonW),
    'CWD',
  ].join('  ');

  const lines: string[] = [header];
  for (const r of rows) {
    lines.push(
      [
        r.id.padEnd(idW),
        r.status.padEnd(stW),
        r.age.padEnd(ageW),
        r.reason.padEnd(reasonW),
        r.cwd,
      ].join('  '),
    );
  }

  const queued = state.queue.length;
  lines.push(`${state.sessions.length} session${state.sessions.length === 1 ? '' : 's'} · ${queued} queued`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CliDeps
// ---------------------------------------------------------------------------

export interface CliDeps {
  request: typeof request;
  ensureDaemon(): Promise<void>;
  tmux: Tmux;
  tuiArgv: string[];
  isInsideTmux(): boolean;
  attachOrSwitch(): number;
  selectTuiWindow(): Promise<void>;
  harnessInfos(): Promise<HarnessInfo[]>;
  now(): number;
  stdout(line: string): void;
  stderr(line: string): void;
}

// ---------------------------------------------------------------------------
// runCli
// ---------------------------------------------------------------------------

const VALID_HARNESSES = new Set<string>([
  'claude',
  'codex',
  'cursor',
  'devin',
  'fake',
]);

export async function runCli(cmd: CliCommand, deps: CliDeps): Promise<number> {
  switch (cmd.kind) {
    case 'attach': {
      await deps.ensureDaemon();
      await deps.tmux.ensureSession(deps.tuiArgv);
      if (deps.isInsideTmux()) {
        deps.attachOrSwitch();
        await deps.selectTuiWindow();
      } else {
        deps.attachOrSwitch();
      }
      return 0;
    }

    case 'new': {
      if (!VALID_HARNESSES.has(cmd.harness)) {
        deps.stderr(`unknown harness: ${cmd.harness}`);
        deps.stderr(`known harnesses: ${[...VALID_HARNESSES].join(', ')}`);
        deps.stderr('run: holo help');
        return 1;
      }
      await deps.ensureDaemon();
      const cwd = resolve(cmd.cwd ?? process.cwd());
      const res = await deps.request({ cmd: 'new', harness: cmd.harness as HarnessId, cwd });
      if (res.ok && 'session' in res) {
        deps.stdout(`spawned ${res.session.id} in ${res.session.tmuxWindow}`);
        if (!deps.isInsideTmux()) {
          deps.attachOrSwitch();
        }
        return 0;
      }
      deps.stderr(res.ok ? 'unexpected response' : res.error);
      return 1;
    }

    case 'next': {
      await deps.ensureDaemon();
      const res = await deps.request({ cmd: 'next' });
      if (res.ok && 'session' in res) {
        const session = res.session;
        deps.stdout(`jumped to ${session.id} — ${session.status}`);
        if (!deps.isInsideTmux()) {
          deps.attachOrSwitch();
        }
        return 0;
      }
      // queue empty is not an error
      deps.stdout(res.ok ? 'queue is empty — all agents running' : res.error);
      return 0;
    }

    case 'ls': {
      await deps.ensureDaemon();
      const res = await deps.request({ cmd: 'ls' });
      if (res.ok && 'state' in res) {
        deps.stdout(formatLs(res.state, deps.now()));
        return 0;
      }
      deps.stderr(res.ok ? 'unexpected response' : res.error);
      return 1;
    }

    case 'setup': {
      // Ensure the holo home directory exists
      const { mkdirSync } = await import('node:fs');
      mkdirSync(holoHome(), { recursive: true });

      // Try to install tmux return binding
      try {
        await deps.tmux.installReturnBinding();
        deps.stdout(
          `tmux return binding installed (prefix+${returnBindingKey()} → TUI window)`,
        );
      } catch {
        deps.stdout('tmux server not running — binding installs on first `holo`');
      }

      // Print harness table
      const infos = await deps.harnessInfos();
      deps.stdout('');
      deps.stdout('Harnesses:');
      for (const info of infos) {
        const mark = info.configured ? '✓ configured' : '✗ not configured';
        deps.stdout(`  ${info.id.padEnd(10)} ${mark}`);
      }

      // Print paths
      const { socketPath, statePath } = await import('./paths');
      deps.stdout('');
      deps.stdout(`Socket:     ${socketPath()}`);
      deps.stdout(`State file: ${statePath()}`);
      return 0;
    }

    case 'help': {
      deps.stdout(helpText());
      return 0;
    }

    case 'unknown': {
      deps.stderr(`unknown command: ${cmd.arg}`);
      deps.stdout(helpText());
      return 1;
    }

    // 'tui' and 'daemon' are handled in index.tsx
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// makeEnsureDaemon
// ---------------------------------------------------------------------------

export function makeEnsureDaemon(opts: {
  spawnDetached(argv: string[], logPath: string): void;
  request: typeof request;
  daemonArgv: string[];
  /** poll interval in ms — default 100 */
  pollIntervalMs?: number;
  /** total timeout in ms — default 3000 */
  timeoutMs?: number;
}): () => Promise<void> {
  const pollIntervalMs = opts.pollIntervalMs ?? 100;
  const timeoutMs = opts.timeoutMs ?? 3000;

  return async () => {
    // Fast path: daemon already running
    try {
      const res = await opts.request({ cmd: 'ping' }, { timeoutMs: 300 });
      if (res.ok) return;
    } catch {
      // fall through to spawn
    }

    const { mkdirSync } = await import('node:fs');
    const logPath = `${holoHome()}/holod.log`;
    mkdirSync(holoHome(), { recursive: true });
    opts.spawnDetached(opts.daemonArgv, logPath);

    // Poll until the daemon responds
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
      try {
        const res = await opts.request({ cmd: 'ping' }, { timeoutMs: 300 });
        if (res.ok) return;
      } catch {
        // keep polling
      }
    }
    throw new Error(`holod failed to start — see ${holoHome()}/holod.log`);
  };
}
