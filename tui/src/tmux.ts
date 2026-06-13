/**
 * Thin tmux shell layer (spec.md "Testing"): all tmux interaction goes
 * through the Tmux interface so the daemon can be tested against FakeTmux.
 * RealTmux builds argv arrays and delegates to a TmuxRunner — tests inject a
 * fake runner and assert exact command construction.
 */

import { execFile, spawnSync } from 'node:child_process';
import { returnBindingKey, tmuxSessionName } from './paths';

export type TmuxRunner = (
  args: string[],
) => Promise<{ status: number; stdout: string; stderr: string }>;

/**
 * pure helper for defaultRunner — execFile reports "tmux ran and exited
 * non-zero" with a numeric error code, but spawn-level failures (ENOENT,
 * EAGAIN, EMFILE, ...) with a string code. Returns null for those: tmux never
 * answered, so the outcome must not be read as a tmux exit.
 */
export function execExitStatus(error: {
  code?: number | string | null;
}): number | null {
  return typeof error.code === 'number' ? error.code : null;
}

/**
 * Runs `tmux <args>`. A real tmux exit resolves with its status — callers
 * decide what failure means. Rejects when tmux could not be asked at all
 * (missing binary, fork/fd pressure), so transient spawn failures are never
 * mistaken for tmux answers.
 */
export const defaultRunner: TmuxRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile('tmux', args, (error, stdout, stderr) => {
      if (!error) {
        resolve({ status: 0, stdout, stderr });
        return;
      }
      const status = execExitStatus(error as { code?: number | string });
      if (status === null) {
        reject(error);
        return;
      }
      resolve({ status, stdout, stderr });
    });
  });

/** -e KEY=VALUE flags for new-session/new-window (tmux >= 3.2) so spawned panes inherit the daemon's identity */
function envFlags(env?: Record<string, string>): string[] {
  return Object.entries(env ?? {}).flatMap(([key, value]) => [
    '-e',
    `${key}=${value}`,
  ]);
}

export interface Tmux {
  sessionExists(): Promise<boolean>;
  /**
   * create the holo session (detached, window "tui") if missing; respawn the
   * tui window if it died (TUI quit); always (re)install the return binding
   */
  ensureSession(tuiArgv: string[], env?: Record<string, string>): Promise<void>;
  /** spawn an agent window; returns the stable window id (e.g. "@3") */
  newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
  }): Promise<string>;
  selectWindow(windowId: string): Promise<void>;
  /** window ids in the holo session; [] when the session is gone; rejects when tmux could not be asked */
  listWindowIds(): Promise<string[]>;
  /**
   * Session-scoped status line (status-right + status-right-length 80),
   * owned by holod. Resolves even on non-zero tmux exit (session doesn't
   * exist yet — nothing to update; the daemon's sweep re-asserts once it
   * does); rejects only when tmux could not be asked at all.
   */
  setStatusRight(text: string): Promise<void>;
  /**
   * prefix+<key> (default Space, HOLO_RETURN_KEY overrides) → jump back to
   * the TUI window. tmux bindings are server-global — they cannot be scoped
   * to one session, so this is a documented deviation from the spec's
   * "installs this binding into the session" wording.
   */
  installReturnBinding(): Promise<void>;
}

export class RealTmux implements Tmux {
  constructor(
    private readonly run: TmuxRunner = defaultRunner,
    private readonly sessionName: string = tmuxSessionName(),
  ) {}

  async sessionExists(): Promise<boolean> {
    const { status } = await this.run(['has-session', '-t', this.sessionName]);
    return status === 0;
  }

  async ensureSession(
    tuiArgv: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    if (!(await this.sessionExists())) {
      await this.run([
        'new-session',
        '-d',
        '-s',
        this.sessionName,
        '-n',
        'tui',
        ...envFlags(env),
        shellQuote(tuiArgv),
      ]);
    } else if (!(await this.hasTuiWindow())) {
      // quitting the TUI kills its window while agent windows keep the
      // session alive — respawn it (detached; the attach path / return
      // binding handle selection) so `holo` can re-enter
      await this.run([
        'new-window',
        '-d',
        '-t',
        `${this.sessionName}:`,
        '-n',
        'tui',
        ...envFlags(env),
        shellQuote(tuiArgv),
      ]);
    }
    await this.installReturnBinding();
  }

  private async hasTuiWindow(): Promise<boolean> {
    const { status, stdout } = await this.run([
      'list-windows',
      '-t',
      this.sessionName,
      '-F',
      '#{window_name}',
    ]);
    return (
      status === 0 && stdout.split('\n').some((line) => line.trim() === 'tui')
    );
  }

  async newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
  }): Promise<string> {
    // trailing "<session>:" target = "next free index in this session"
    const { status, stdout, stderr } = await this.run([
      'new-window',
      '-d',
      '-t',
      `${this.sessionName}:`,
      '-n',
      opts.name,
      '-c',
      opts.cwd,
      '-P',
      '-F',
      '#{window_id}',
      ...envFlags(opts.env),
      shellQuote(opts.argv),
    ]);
    if (status !== 0) {
      throw new Error(`tmux new-window failed (${status}): ${stderr.trim()}`);
    }
    return stdout.trim();
  }

  async selectWindow(windowId: string): Promise<void> {
    await this.run(['select-window', '-t', windowId]);
  }

  async listWindowIds(): Promise<string[]> {
    const { status, stdout } = await this.run([
      'list-windows',
      '-t',
      this.sessionName,
      '-F',
      '#{window_id}',
    ]);
    // session gone — panes die with the tmux server, so "exited" is correct.
    // Spawn-level failures reject in the runner instead and propagate.
    if (status !== 0) return [];
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }

  async setStatusRight(text: string): Promise<void> {
    // one invocation, two commands — the lone ';' is tmux's command separator
    // (execFile, no shell, passed literally). Re-sending the length on every
    // call makes a recreated session self-heal past tmux's 40-col default
    // status-right-length, which silently truncates. Non-zero exit is ignored
    // (session gone is normal); spawn-level rejections propagate.
    await this.run([
      'set-option',
      '-t',
      this.sessionName,
      'status-right-length',
      '80',
      ';',
      'set-option',
      '-t',
      this.sessionName,
      'status-right',
      text,
    ]);
  }

  async installReturnBinding(): Promise<void> {
    await this.run([
      'bind-key',
      returnBindingKey(),
      'select-window',
      '-t',
      `${this.sessionName}:tui`,
    ]);
  }
}

export interface FakeWindow {
  name: string;
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
}

/** In-memory Tmux for daemon tests — no tmux server involved. */
export class FakeTmux implements Tmux {
  readonly windows = new Map<string, FakeWindow>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  selected: string | null = null;
  statusRight: string | null = null;
  /** models the dedicated "tui" window apart from agent windows so agent window ids stay stable */
  tuiWindow: { argv: string[]; env?: Record<string, string> } | null = null;
  private created = false;
  private nextId = 1;

  async sessionExists(): Promise<boolean> {
    return this.created;
  }

  async ensureSession(
    tuiArgv: string[],
    env?: Record<string, string>,
  ): Promise<void> {
    // record env only when given so exact call assertions stay stable
    this.calls.push({
      method: 'ensureSession',
      args: env === undefined ? [tuiArgv] : [tuiArgv, env],
    });
    this.created = true;
    if (this.tuiWindow === null) {
      this.tuiWindow = { argv: [...tuiArgv] };
      if (env) this.tuiWindow.env = { ...env };
    }
  }

  async newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
  }): Promise<string> {
    const id = `@${this.nextId++}`;
    const window: FakeWindow = {
      name: opts.name,
      cwd: opts.cwd,
      argv: [...opts.argv],
    };
    if (opts.env) window.env = { ...opts.env };
    this.windows.set(id, window);
    return id;
  }

  async selectWindow(windowId: string): Promise<void> {
    this.selected = windowId;
  }

  async listWindowIds(): Promise<string[]> {
    return [...this.windows.keys()];
  }

  async setStatusRight(text: string): Promise<void> {
    this.calls.push({ method: 'setStatusRight', args: [text] });
    this.statusRight = text;
  }

  async installReturnBinding(): Promise<void> {
    this.calls.push({ method: 'installReturnBinding', args: [] });
  }

  /** test helper: simulate a window dying (process exit, manual kill) */
  closeWindow(id: string): void {
    this.windows.delete(id);
    if (this.selected === id) this.selected = null;
  }

  /** test helper: simulate the TUI process quitting (its window dies with it) */
  closeTuiWindow(): void {
    this.tuiWindow = null;
  }
}

/**
 * POSIX single-quote each arg and join with spaces. tmux new-session /
 * new-window take ONE shell-command argument, so a spawned argv must be
 * collapsed into a single safely-quoted string.
 */
export function shellQuote(args: string[]): string {
  return args.map((arg) => `'${arg.replace(/'/g, `'\\''`)}'`).join(' ');
}

export function isInsideTmux(): boolean {
  return !!process.env.TMUX;
}

/** pure helper for attachOrSwitch — inside tmux you must switch-client, not nest attach */
export function pickAttachArgs(insideTmux: boolean, name: string): string[] {
  return insideTmux
    ? ['switch-client', '-t', name]
    : ['attach-session', '-t', name];
}

/**
 * Attach the current terminal to the holo session (blocks until detach).
 * Returns the tmux exit status.
 */
export function attachOrSwitch(
  sessionName: string = tmuxSessionName(),
): number {
  const result = spawnSync(
    'tmux',
    pickAttachArgs(isInsideTmux(), sessionName),
    {
      stdio: 'inherit',
    },
  );
  return result.status ?? 1;
}
