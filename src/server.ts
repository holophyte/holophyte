// TODO: When this file crosses ~500 lines, split into src/server/ modules:
// - convex-client.ts (callConvexInternal, queryConvexInternal)
// - companion.ts (polling loop + start/stop)
// Keep routes inline in server.ts — they're tightly coupled to Bun.serve().

import { basename } from 'node:path';
import type { PermissionMode, WsServerMessage } from '@/claude/manager';
import homepage from '../public/index.html';
import {
  getSession,
  respondToApproval,
  sendMessageToSession,
  startSession,
  stopSession,
  subscribe,
} from './claude/manager';

// ── Convex internal API helpers ──────────────────────────────────────

/** Whether a startup warning about missing config has already been logged. */
let configWarningLogged = false;

function getConvexConfig() {
  const baseUrl = process.env.CONVEX_SITE_URL;
  const secret = process.env.INTERNAL_API_SECRET;

  if (!baseUrl || !secret) {
    if (!configWarningLogged) {
      configWarningLogged = true;
      const missing = [
        !baseUrl && 'CONVEX_SITE_URL',
        !secret && 'INTERNAL_API_SECRET',
      ].filter(Boolean);
      console.error(
        `WARNING: ${missing.join(' and ')} not set — session data will not be persisted to the database`,
      );
    }
    return null;
  }
  return { baseUrl, secret };
}

/**
 * Calls a Convex HTTP action. Returns `true` if the call succeeded, `false`
 * if it was skipped (missing config). Throws on HTTP errors.
 */
async function callConvexInternal(
  path: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const config = getConvexConfig();
  if (!config) return false;

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex HTTP action failed (${res.status}): ${text}`);
  }

  return true;
}

async function queryConvexInternal<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const config = getConvexConfig();
  if (!config)
    throw new Error('CONVEX_SITE_URL or INTERNAL_API_SECRET not set');

  const res = await fetch(`${config.baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.secret}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Convex HTTP action failed (${res.status}): ${text}`);
  }

  return (await res.json()) as T;
}

// ── Companion polling ────────────────────────────────────────────────

interface QueuedSession {
  _id: string;
  queuedPrompt?: string;
  sdkSessionId?: string;
  model?: string;
  permissionMode?: string;
  repoPath: string;
}

interface StoppedSession {
  _id: string;
}

interface PendingMessage {
  _id: string;
  sessionId: string;
  text: string;
}

const POLL_INTERVAL_MS = 2000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let polling = false;

async function companionPoll() {
  if (polling) return; // Skip if previous poll is still running
  polling = true;

  try {
    // 1. Pick up queued sessions
    const queued = await queryConvexInternal<QueuedSession[]>(
      '/api/internal/sessions/listQueued',
      {},
    );
    for (const session of queued) {
      if (!session.queuedPrompt) continue;
      // Skip if this session is already running locally
      if (getSession(session._id)) continue;

      try {
        const claimed = await queryConvexInternal<{ ok: boolean }>(
          '/api/internal/sessions/claimQueued',
          { id: session._id },
        );
        if (!claimed.ok) continue;

        await startSession({
          sessionId: session._id,
          repoPath: session.repoPath,
          prompt: session.queuedPrompt,
          model: session.model,
          permissionMode: session.permissionMode as PermissionMode | undefined,
          resumeSdkSessionId: session.sdkSessionId,
        });
      } catch (err) {
        console.error(`Failed to pick up queued session ${session._id}:`, err);
        // Mark as failed so it doesn't retry forever
        try {
          await callConvexInternal('/api/internal/sessions/updateStatus', {
            id: session._id,
            status: 'failed',
          });
        } catch {
          // Best-effort
        }
      }
    }

    // 2. Check for stopped sessions (user requested stop via Convex)
    const stopped = await queryConvexInternal<StoppedSession[]>(
      '/api/internal/sessions/listStopped',
      {},
    );
    for (const session of stopped) {
      if (getSession(session._id)) {
        stopSession(session._id);
      } else {
        // Session not running locally — transition to idle directly
        try {
          await callConvexInternal('/api/internal/sessions/updateStatus', {
            id: session._id,
            status: 'idle',
          });
        } catch {
          // Best-effort
        }
      }
    }

    // 3. Deliver pending messages to running sessions
    const messages = await queryConvexInternal<PendingMessage[]>(
      '/api/internal/sessionMessages/listPending',
      {},
    );
    for (const msg of messages) {
      const delivered = sendMessageToSession(msg.sessionId, msg.text);
      // Mark consumed only on successful delivery — if the session isn't
      // running locally, leave the message unconsumed for retry.
      if (delivered) {
        try {
          await callConvexInternal(
            '/api/internal/sessionMessages/markConsumed',
            { id: msg._id },
          );
        } catch (err) {
          console.error(`Failed to mark message ${msg._id} as consumed:`, err);
        }
      }
    }
  } catch (err) {
    // Don't log every poll failure (noisy when Convex is unavailable)
    if (String(err).includes('not set')) return;
    console.error('Companion poll error:', err);
  } finally {
    polling = false;
  }
}

function startCompanionPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(companionPoll, POLL_INTERVAL_MS);
  // Run immediately on start
  void companionPoll();
}

function stopCompanionPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── HTTP Server ──────────────────────────────────────────────────────

interface WsData {
  sessionId: string;
  cleanups: (() => void)[];
}

const server = Bun.serve<WsData>({
  port: Number(process.env.PORT) || 8080,
  routes: {
    '/': homepage,

    // Serves app config as a JS global, loaded by <script src="/config.js">
    // in index.html. This replaces the old fetch('/api/config') call.
    '/config.js': {
      GET() {
        const config = {
          convexUrl: process.env.CONVEX_URL ?? '',
          e2eTest:
            !!process.env.E2E_TEST && process.env.NODE_ENV !== 'production',
          allowAnonymousAuth:
            process.env.NODE_ENV !== 'production' &&
            !!process.env.ALLOW_ANONYMOUS_AUTH,
          homeDir: process.env.HOME ?? '',
        };
        return new Response(
          `window.__HOLOPHYTE_CONFIG__=${JSON.stringify(config)};`,
          { headers: { 'Content-Type': 'application/javascript' } },
        );
      },
    },

    // Proxy /api/auth/* to the Convex site URL so OAuth callbacks work through
    // the app port. GitHub/Google redirect back to SITE_URL (the app port) and
    // we forward the request to Convex's HTTP actions to complete the flow.
    // Must be in `routes` (above the SPA catch-all) so GET requests aren't
    // swallowed by the `/*` → homepage handler.
    '/api/auth/*': async (req: Request) => {
      const convexSiteUrl = process.env.CONVEX_SITE_URL;
      if (!convexSiteUrl) {
        return new Response('CONVEX_SITE_URL not configured', { status: 500 });
      }
      const url = new URL(req.url);
      const target = `${convexSiteUrl}${url.pathname}${url.search}`;
      try {
        const proxyRes = await fetch(target, {
          method: req.method,
          headers: req.headers,
          body: req.body,
          redirect: 'manual',
        });
        return new Response(proxyRes.body, {
          status: proxyRes.status,
          headers: proxyRes.headers,
        });
      } catch (err) {
        console.error('Auth proxy error:', err);
        return Response.json({ error: 'Auth proxy failed' }, { status: 502 });
      }
    },

    '/api/pick-directory': {
      async POST() {
        try {
          if (process.platform !== 'darwin') {
            return Response.json(
              { error: 'Directory picker only supported on macOS' },
              { status: 501 },
            );
          }
          const proc = Bun.spawn(
            [
              'osascript',
              '-e',
              `POSIX path of (choose folder with prompt "Select a git repository" default location "${(process.env.HOME ?? '/').replace(/"/g, '\\"')}")`,
            ],
            { stdout: 'pipe', stderr: 'pipe' },
          );
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            return Response.json({ cancelled: true });
          }
          const raw = await new Response(proc.stdout).text();
          const dirPath = raw.trim().replace(/\/$/, '');

          const gitDir = Bun.file(`${dirPath}/.git`);
          const isGitRepo = await gitDir.exists();

          return Response.json({
            cancelled: false,
            path: dirPath,
            name: basename(dirPath),
            isGitRepo,
          });
        } catch (err) {
          console.error('Failed to open directory picker:', err);
          return Response.json(
            { error: 'Failed to open directory picker.' },
            { status: 500 },
          );
        }
      },
    },

    // SPA catch-all: serve the bundled app HTML for all unmatched GET routes.
    // Must be in `routes` (not `fetch`) so Bun serves the HTML *bundle* with
    // compiled asset paths (/_bun/...) rather than the raw source file.
    // Only match GET — POST/etc. must fall through to `fetch` for dynamic API routes.
    '/*': { GET: homepage },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /ws/session/:sessionId
    if (url.pathname.startsWith('/ws/session/')) {
      const sessionId = url.pathname.slice('/ws/session/'.length);
      const upgraded = server.upgrade(req, {
        data: { sessionId, cleanups: [] },
      });
      if (upgraded) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      const { sessionId } = ws.data;
      const session = getSession(sessionId);
      if (!session) {
        ws.send(
          JSON.stringify({
            type: 'error',
            sessionId,
            message: 'Session not found',
          }),
        );
        ws.close();
        return;
      }

      const unsub = subscribe(sessionId, (msg: WsServerMessage) => {
        ws.send(JSON.stringify(msg));
      });

      ws.data.cleanups = [unsub];
    },

    message(ws, rawMessage) {
      // Handle client JSON messages (approve/deny via WebSocket)
      try {
        const msg = JSON.parse(String(rawMessage));
        if (msg.type === 'approve' && msg.requestId) {
          respondToApproval(ws.data.sessionId, msg.requestId, true);
        } else if (msg.type === 'deny' && msg.requestId) {
          respondToApproval(
            ws.data.sessionId,
            msg.requestId,
            false,
            msg.message,
          );
        }
      } catch {
        // Ignore non-JSON messages
      }
    },

    close(ws) {
      for (const cleanup of ws.data.cleanups) {
        cleanup();
      }
    },
  },

  development: {
    hmr: true,
    console: true,
  },
});

console.log(`Holophyte running at http://localhost:${server.port}`);
console.log(`  Convex URL: ${process.env.CONVEX_URL || '(not set)'}`);
console.log(`  Convex Site: ${process.env.CONVEX_SITE_URL || '(not set)'}`);

// Start companion polling for queued/stopped sessions
startCompanionPolling();

// On startup, clean up sessions left in inconsistent states from a prior crash
// or companion outage:
//   - 'running' → 'idle': process died without finalising the turn
//   - 'stopped' → 'idle': stop request was never processed (companion was offline)
(async () => {
  try {
    await callConvexInternal('/api/internal/sessions/markStaleRunning', {});
  } catch {
    // Non-critical — Convex may not be configured yet
  }
  try {
    await callConvexInternal('/api/internal/sessions/markStoppedAsIdle', {});
  } catch {
    // Non-critical — Convex may not be configured yet
  }
})();

process.on('SIGINT', () => {
  stopCompanionPolling();
  server.stop();
  process.exit(0);
});
