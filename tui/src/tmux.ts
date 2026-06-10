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
 * Runs `tmux <args>`. Non-zero exit resolves with its status — callers decide
 * what failure means. Rejects only when the tmux binary itself is missing.
 */
export const defaultRunner: TmuxRunner = (args) =>
  new Promise((resolve, reject) => {
    execFile('tmux', args, (error, stdout, stderr) => {
      if (!error) {
        resolve({ status: 0, stdout, stderr });
        return;
      }
      // execFile error code: number = exit status, 'ENOENT' = binary missing
      const code = (error as { code?: number | string }).code;
      if (code === 'ENOENT') {
        reject(error);
        return;
      }
      resolve({ status: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });

export interface Tmux {
  sessionExists(): Promise<boolean>;
  /** create the holo session (detached, window "tui") if missing; always (re)install the return binding */
  ensureSession(tuiArgv: string[]): Promise<void>;
  /** spawn an agent window; returns the stable window id (e.g. "@3") */
  newWindow(opts: { name: string; cwd: string; argv: string[] }): Promise<string>;
  selectWindow(windowId: string): Promise<void>;
  /** window ids in the holo session; [] when the session is gone */
  listWindowIds(): Promise<string[]>;
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

  async ensureSession(tuiArgv: string[]): Promise<void> {
    if (!(await this.sessionExists())) {
      await this.run([
        'new-session',
        '-d',
        '-s',
        this.sessionName,
        '-n',
        'tui',
        shellQuote(tuiArgv),
      ]);
    }
    await this.installReturnBinding();
  }

  async newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
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
    if (status !== 0) return []; // session gone
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
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
}

/** In-memory Tmux for daemon tests — no tmux server involved. */
export class FakeTmux implements Tmux {
  readonly windows = new Map<string, FakeWindow>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  selected: string | null = null;
  private created = false;
  private nextId = 1;

  async sessionExists(): Promise<boolean> {
    return this.created;
  }

  async ensureSession(tuiArgv: string[]): Promise<void> {
    this.calls.push({ method: 'ensureSession', args: [tuiArgv] });
    this.created = true;
  }

  async newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
  }): Promise<string> {
    const id = `@${this.nextId++}`;
    this.windows.set(id, {
      name: opts.name,
      cwd: opts.cwd,
      argv: [...opts.argv],
    });
    return id;
  }

  async selectWindow(windowId: string): Promise<void> {
    this.selected = windowId;
  }

  async listWindowIds(): Promise<string[]> {
    return [...this.windows.keys()];
  }

  async installReturnBinding(): Promise<void> {
    this.calls.push({ method: 'installReturnBinding', args: [] });
  }

  /** test helper: simulate a window dying (process exit, manual kill) */
  closeWindow(id: string): void {
    this.windows.delete(id);
    if (this.selected === id) this.selected = null;
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
export function attachOrSwitch(sessionName: string = tmuxSessionName()): number {
  const result = spawnSync('tmux', pickAttachArgs(isInsideTmux(), sessionName), {
    stdio: 'inherit',
  });
  return result.status ?? 1;
}
