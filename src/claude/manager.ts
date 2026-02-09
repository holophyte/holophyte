import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { ConvexHttpClient } from "convex/browser";
import * as pty from "node-pty";

interface Session {
  pty: pty.IPty;
  taskId: Id<"tasks">;
  convexSessionId: Id<"sessions">;
  subscribers: Set<(data: string) => void>;
}

const convex = new ConvexHttpClient(process.env.CONVEX_URL ?? "");

const sessions = new Map<string, Session>();

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
  // Create session in Convex
  const convexSessionId = await convex.mutation(api.sessions.create, {
    taskId: opts.taskId,
  });

  const sessionId = convexSessionId;

  // Spawn claude with node-pty
  const shell = pty.spawn("claude", [opts.prompt], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: opts.repoPath,
    env: {
      ...process.env,
      TERM: "xterm-256color",
    } as Record<string, string>,
  });

  const session: Session = {
    pty: shell,
    taskId: opts.taskId,
    convexSessionId,
    subscribers: new Set(),
  };

  sessions.set(sessionId, session);

  // Forward PTY output to all subscribers
  shell.onData((data) => {
    for (const cb of session.subscribers) {
      cb(data);
    }
  });

  // Handle process exit
  shell.onExit(async ({ exitCode }) => {
    const status = exitCode === 0 ? "completed" : "failed";
    try {
      await convex.mutation(api.sessions.updateStatus, {
        id: convexSessionId,
        status,
      });
    } catch (err) {
      console.error("Failed to update session status:", err);
    }
    sessions.delete(sessionId);
  });

  return { sessionId };
}

export async function stopSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.pty.kill();

  try {
    await convex.mutation(api.sessions.updateStatus, {
      id: session.convexSessionId,
      status: "stopped",
    });
  } catch (err) {
    console.error("Failed to update session status:", err);
  }

  sessions.delete(sessionId);
}

export function resizeSession(
  sessionId: string,
  cols: number,
  rows: number,
): void {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.pty.resize(cols, rows);
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
  session.pty.write(data);
}
