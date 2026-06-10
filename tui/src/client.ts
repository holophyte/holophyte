/**
 * Client side of the daemon socket — used by the CLI, the hook entry, and
 * the TUI. Request/response clients open a fresh connection per request;
 * the TUI holds a subscription connection open.
 */

import net from 'node:net';
import { onJsonLines, writeJsonLine } from './ndjson';
import { socketPath } from './paths';
import type { Request, Response, StatePush } from './protocol';
import { isStatePush } from './protocol';

const DEFAULT_TIMEOUT_MS = 2000;

/** One request, one response line. Rejects on connect failure or timeout. */
export function request(
  req: Request,
  opts: { timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath());
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`daemon request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    socket.on('connect', () => {
      writeJsonLine(socket, req);
    });
    onJsonLines(socket, (value) => {
      clearTimeout(timer);
      socket.end();
      resolve(value as Response);
    });
  });
}

/**
 * request() that never throws — hook adapters must fail silently and fast
 * when the daemon is down, never blocking the agent.
 */
export async function tryRequest(
  req: Request,
  opts: { timeoutMs?: number } = {},
): Promise<Response | null> {
  try {
    return await request(req, opts);
  } catch {
    return null;
  }
}

export interface Subscription {
  close(): void;
}

/**
 * Subscribe to daemon state. The daemon sends a full StatePush snapshot
 * immediately, then another on every change. `onClose` fires exactly once
 * when the connection drops (daemon restart etc.) — reconnect policy is the
 * caller's job.
 */
export function subscribe(handlers: {
  onState: (push: StatePush) => void;
  onClose?: () => void;
}): Subscription {
  const socket = net.createConnection(socketPath());
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    handlers.onClose?.();
  };
  socket.on('connect', () => {
    writeJsonLine(socket, { cmd: 'subscribe' } satisfies Request);
  });
  socket.on('error', fireClose);
  socket.on('close', fireClose);
  onJsonLines(socket, (value) => {
    if (isStatePush(value)) handlers.onState(value);
  });
  return {
    close() {
      closed = true;
      socket.destroy();
    },
  };
}
