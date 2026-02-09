import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Subprocess } from "bun";
import { ConvexHttpClient } from "convex/browser";

interface Session {
  proc: Subprocess;
  taskId: Id<"tasks">;
  convexSessionId: Id<"sessions">;
  subscribers: Set<(data: string) => void>;
}

const convex = new ConvexHttpClient(process.env.CONVEX_URL ?? "");

const sessions = new Map<string, Session>();

// Resolve the user's login shell env so spawned processes can find `claude`
async function getShellEnv(): Promise<Record<string, string>> {
  const shell = process.env.SHELL ?? "/bin/zsh";
  const proc = Bun.spawn([shell, "-ilc", "env"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const env: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const idx = line.indexOf("=");
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
  const pathDirs = (env.PATH ?? "").split(":");
  for (const dir of pathDirs) {
    const candidate = `${dir}/claude`;
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return candidate;
    }
  }
  return "claude";
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getActiveSessions(): string[] {
  return Array.from(sessions.keys());
}

export async function startSession(opts: {
  taskId: Id<"tasks">;
  repoPath: string;
  prompt: string;
}): Promise<{ sessionId: string }> {
  const claudePath = await resolveClaudePath();
  const env = await getEnv();

  // Create session in Convex
  const convexSessionId = await convex.mutation(api.sessions.create, {
    taskId: opts.taskId,
  });

  const sessionId = convexSessionId;

  const session: Session = {
    proc: null as unknown as Subprocess,
    taskId: opts.taskId,
    convexSessionId,
    subscribers: new Set(),
  };

  // Use Bun's native PTY support (available since Bun v1.3.5)
  const proc = Bun.spawn([claudePath, opts.prompt], {
    cwd: opts.repoPath,
    env: {
      ...env,
      TERM: "xterm-256color",
    },
    terminal: {
      cols: 120,
      rows: 30,
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
  proc.exited.then(async (exitCode) => {
    const status = exitCode === 0 ? "completed" : "failed";
    try {
      await convex.mutation(api.sessions.updateStatus, {
        id: convexSessionId,
        status,
      });
    } catch (err) {
      console.error("Failed to update session status:", err);
    }
    proc.terminal?.close();
    sessions.delete(sessionId);
  });

  return { sessionId };
}

export async function stopSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.proc.kill();

  try {
    await convex.mutation(api.sessions.updateStatus, {
      id: session.convexSessionId,
      status: "stopped",
    });
  } catch (err) {
    console.error("Failed to update session status:", err);
  }

  session.proc.terminal?.close();
  sessions.delete(sessionId);
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

export function writeToSession(sessionId: string, data: string): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.proc.terminal?.write(data);
}
