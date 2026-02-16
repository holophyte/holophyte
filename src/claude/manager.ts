import type { Subprocess } from 'bun';
import { TERMINAL_DEFAULTS } from '@/constants';

/** Sent to subscribers when the PTY process exits. */
export interface SessionExitEvent {
  type: 'session_exit';
  status: 'completed' | 'failed';
  exitCode: number;
}

interface Session {
  proc: Subprocess;
  subscribers: Set<(data: string) => void>;
  exitCallbacks: Set<(event: SessionExitEvent) => void>;
}

const sessions = new Map<string, Session>();

// Resolve the user's login shell env so spawned processes can find `claude`
async function getShellEnv(): Promise<Record<string, string>> {
  const shell = process.env.SHELL ?? '/bin/zsh';
  const proc = Bun.spawn([shell, '-ilc', 'env'], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = await new Response(proc.stdout).text();
  const env: Record<string, string> = {};
  for (const line of output.split('\n')) {
    const idx = line.indexOf('=');
    if (idx > 0) {
      env[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }
  return env;
}

let shellEnvCache: Record<string, string> | null = null;

async function getEnv(): Promise<Record<string, string>> {
  if (!shellEnvCache) {
    try {
      shellEnvCache = await getShellEnv();
    } catch {
      shellEnvCache = process.env as Record<string, string>;
    }
  }
  return shellEnvCache;
}

// Resolve full path to claude binary
async function resolveClaudePath(): Promise<string> {
  const env = await getEnv();
  const pathDirs = (env.PATH ?? '').split(':');
  for (const dir of pathDirs) {
    const candidate = `${dir}/claude`;
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return candidate;
    }
  }
  return 'claude';
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getActiveSessions(): string[] {
  return Array.from(sessions.keys());
}

export async function startSession(opts: {
  sessionId: string;
  repoPath: string;
  prompt: string;
}): Promise<{ sessionId: string }> {
  const claudePath = await resolveClaudePath();
  const env = await getEnv();

  const { sessionId } = opts;

  const session: Session = {
    proc: null as unknown as Subprocess,
    subscribers: new Set(),
    exitCallbacks: new Set(),
  };

  // Use Bun's native PTY support (available since Bun v1.3.5)
  const proc = Bun.spawn([claudePath, opts.prompt], {
    cwd: opts.repoPath,
    env: {
      ...env,
      TERM: 'xterm-256color',
    },
    terminal: {
      cols: TERMINAL_DEFAULTS.cols,
      rows: TERMINAL_DEFAULTS.rows,
      data(_terminal, data) {
        const text = new TextDecoder().decode(data);
        for (const cb of session.subscribers) {
          cb(text);
        }
      },
    },
  });

  session.proc = proc;
  sessions.set(sessionId, session);

  // Handle process exit
  proc.exited.then((exitCode) => {
    const event: SessionExitEvent = {
      type: 'session_exit',
      status: exitCode === 0 ? 'completed' : 'failed',
      exitCode,
    };
    for (const cb of session.exitCallbacks) {
      cb(event);
    }
    proc.terminal?.close();
    sessions.delete(sessionId);
  });

  return { sessionId };
}

export function stopSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.proc.terminal?.close();
  session.proc.kill('SIGKILL');
  // Session cleanup happens in the proc.exited handler
}

export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.proc.terminal?.resize(cols, rows);
}

export function subscribe(
  sessionId: string,
  callback: (data: string) => void,
): () => void {
  const session = sessions.get(sessionId);
  if (!session) return () => {};
  session.subscribers.add(callback);
  return () => {
    session.subscribers.delete(callback);
  };
}

/** Register a callback for when the session's PTY process exits. */
export function onSessionExit(
  sessionId: string,
  callback: (event: SessionExitEvent) => void,
): () => void {
  const session = sessions.get(sessionId);
  if (!session) return () => {};
  session.exitCallbacks.add(callback);
  return () => {
    session.exitCallbacks.delete(callback);
  };
}

export function writeToSession(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.proc.terminal?.write(data);
}
