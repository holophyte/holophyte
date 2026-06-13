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
  /** spawn an agent window; returns the stable window id, its initial (agent) pane id, and the window's width in cols */
  newWindow(opts: {
    name: string;
    cwd: string;
    argv: string[];
    env?: Record<string, string>;
  }): Promise<{ windowId: string; paneId: string; width: number }>;
  selectWindow(windowId: string): Promise<void>;
  /**
   * Arm the sidebar death trap: pane-scoped pane-died hook + remain-on-exit on
   * the AGENT pane, so the whole window dies the moment the agent process does.
   * Two sequential calls, hook first — remain-on-exit must never be set without
   * the hook (a dead pane would hold the window open forever). Returns false on
   * any non-zero tmux exit (callers then skip the split); rejects only when
   * tmux could not be asked at all.
   */
  setKillWindowOnPaneDeath(paneId: string, windowId: string): Promise<boolean>;
  /** narrow right-hand split beside the agent pane; -d keeps the agent pane active; throws on non-zero exit */
  splitSidebar(opts: {
    paneId: string;
    argv: string[];
    widthCols: number;
    env?: Record<string, string>;
  }): Promise<void>;
  /** focus a pane within its window (jump/next land on the agent, not the sidebar). Non-zero exit ignored, like selectWindow. */
  selectPane(paneId: string): Promise<void>;
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
  }): Promise<{ windowId: string; paneId: string; width: number }> {
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
      '#{window_id} #{pane_id} #{window_width}',
      ...envFlags(opts.env),
      shellQuote(opts.argv),
    ]);
    if (status !== 0) {
      throw new Error(`tmux new-window failed (${status}): ${stderr.trim()}`);
    }
    // '@N'/'%N' never contain spaces, so three space-separated fields
    const fields = stdout.trim().split(' ');
    const [windowId, paneId, widthField] = fields;
    const width = Number(widthField);
    if (
      fields.length !== 3 ||
      !windowId ||
      !paneId ||
      !widthField ||
      Number.isNaN(width)
    ) {
      throw new Error(`tmux new-window returned malformed output: ${stdout}`);
    }
    return { windowId, paneId, width };
  }

  async selectWindow(windowId: string): Promise<void> {
    await this.run(['select-window', '-t', windowId]);
  }

  async setKillWindowOnPaneDeath(
    paneId: string,
    windowId: string,
  ): Promise<boolean> {
    // hook FIRST: remain-on-exit without the hook wedges a window forever
    // (the dead pane holds it open). Separate calls, never a ';' chain — a
    // chain keeps executing after an earlier failure. The window id is
    // embedded literally; tmux never reuses @N within a server lifetime, so
    // the trap can't kill a recycled window.
    const hook = await this.run([
      'set-hook',
      '-p',
      '-t',
      paneId,
      'pane-died',
      `kill-window -t ${windowId}`,
    ]);
    if (hook.status !== 0) return false;
    const remain = await this.run([
      'set-option',
      '-p',
      '-t',
      paneId,
      'remain-on-exit',
      'on',
    ]);
    return remain.status === 0;
  }

  async splitSidebar(opts: {
    paneId: string;
    argv: string[];
    widthCols: number;
    env?: Record<string, string>;
  }): Promise<void> {
    // no -P (the sidebar pane id is unused), no -c (the sidebar ignores cwd;
    // it dials the socket via HOLO_HOME from -e). -e needs tmux >= 3.2 — the
    // same floor envFlags already assumes.
    const { status, stderr } = await this.run([
      'split-window',
      '-d',
      '-h',
      '-l',
      String(opts.widthCols),
      '-t',
      opts.paneId,
      ...envFlags(opts.env),
      shellQuote(opts.argv),
    ]);
    if (status !== 0) {
      throw new Error(`tmux split-window failed (${status}): ${stderr.trim()}`);
    }
  }

  async selectPane(paneId: string): Promise<void> {
    await this.run(['select-pane', '-t', paneId]);
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
  agentPane: string;
  /** kill-window-on-agent-death trap armed (hook + remain-on-exit) */
  deathTrap: boolean;
  sidebar?: { argv: string[]; widthCols: number; env?: Record<string, string> };
}

/** In-memory Tmux for daemon tests — no tmux server involved. */
export class FakeTmux implements Tmux {
  readonly windows = new Map<string, FakeWindow>();
  readonly calls: Array<{ method: string; args: unknown[] }> = [];
  selected: string | null = null;
  selectedPane: string | null = null;
  statusRight: string | null = null;
  /** width newWindow reports — tests set 80 for the narrow-terminal case */
  windowWidth = 200;
  /** outcome of setKillWindowOnPaneDeath — tests set false for trap failure */
  trapResult = true;
  /** models the dedicated "tui" window apart from agent windows so agent window ids stay stable */
  tuiWindow: { argv: string[]; env?: Record<string, string> } | null = null;
  private created = false;
  private nextId = 1;
  /** pane ids are server-global and never reused, independent of window ids */
  private nextPaneId = 1;

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
  }): Promise<{ windowId: string; paneId: string; width: number }> {
    const id = `@${this.nextId++}`;
    const agentPane = `%${this.nextPaneId++}`;
    const window: FakeWindow = {
      name: opts.name,
      cwd: opts.cwd,
      argv: [...opts.argv],
      agentPane,
      deathTrap: false,
    };
    if (opts.env) window.env = { ...opts.env };
    this.windows.set(id, window);
    return { windowId: id, paneId: agentPane, width: this.windowWidth };
  }

  async selectWindow(windowId: string): Promise<void> {
    this.selected = windowId;
  }

  async setKillWindowOnPaneDeath(
    paneId: string,
    windowId: string,
  ): Promise<boolean> {
    this.calls.push({
      method: 'setKillWindowOnPaneDeath',
      args: [paneId, windowId],
    });
    const window = this.windows.get(windowId);
    if (!window || window.agentPane !== paneId) return false;
    window.deathTrap = this.trapResult;
    return this.trapResult;
  }

  async splitSidebar(opts: {
    paneId: string;
    argv: string[];
    widthCols: number;
    env?: Record<string, string>;
  }): Promise<void> {
    this.calls.push({ method: 'splitSidebar', args: [opts] });
    const window = [...this.windows.values()].find(
      (w) => w.agentPane === opts.paneId,
    );
    if (!window) throw new Error(`no such pane: ${opts.paneId}`); // mirrors tmux
    window.sidebar = {
      argv: [...opts.argv],
      widthCols: opts.widthCols,
      ...(opts.env ? { env: { ...opts.env } } : {}),
    };
  }

  async selectPane(paneId: string): Promise<void> {
    this.calls.push({ method: 'selectPane', args: [paneId] });
    this.selectedPane = paneId;
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

  /**
   * test helper: the agent process exits — models the live-verified tmux
   * semantics. Trap armed (or no sidebar pane left) → the whole window
   * closes; an untrapped window with a sidebar LEAKS sidebar-only, which is
   * exactly what the death trap prevents.
   */
  exitAgentPane(id: string): void {
    const window = this.windows.get(id);
    if (!window) return;
    if (window.deathTrap || window.sidebar === undefined) {
      this.closeWindow(id);
      return;
    }
    window.agentPane = '';
  }

  /** test helper: the user kills the sidebar pane (prefix+x / sidebar `q`) */
  closeSidebarPane(id: string): void {
    const window = this.windows.get(id);
    if (window) delete window.sidebar;
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
