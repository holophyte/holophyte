import type { WsServerMessage } from '@/claude/manager';
import homepage from '../public/index.html';
import {
  getSession,
  respondToApproval,
  startSession,
  stopSession,
  subscribe,
} from './claude/manager';

interface WsData {
  sessionId: string;
  cleanups: (() => void)[];
}

const server = Bun.serve<WsData>({
  port: Number(process.env.PORT) || 8080,
  routes: {
    '/': homepage,

    '/api/config': {
      GET() {
        return Response.json({
          convexUrl: process.env.CONVEX_URL ?? '',
          e2eTest:
            !!process.env.E2E_TEST && process.env.NODE_ENV !== 'production',
        });
      },
    },

    '/api/pick-directory': {
      async POST() {
        try {
          const proc = Bun.spawn(
            [
              'osascript',
              '-e',
              'POSIX path of (choose folder with prompt "Select a git repository")',
            ],
            { stdout: 'pipe', stderr: 'pipe' },
          );
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            // User cancelled the dialog
            return Response.json({ cancelled: true });
          }
          const raw = await new Response(proc.stdout).text();
          // osascript returns path with trailing newline and slash
          const dirPath = raw.trim().replace(/\/$/, '');
          const { basename } = await import('node:path');

          const gitHead = Bun.file(`${dirPath}/.git/HEAD`);
          const isGitRepo = await gitHead.exists();

          // Try to get the repo name from the git remote URL
          let name = basename(dirPath);
          if (isGitRepo) {
            try {
              const gitConfig = await Bun.file(`${dirPath}/.git/config`).text();
              const remoteMatch = gitConfig.match(
                /\[remote "origin"\][^[]*url\s*=\s*(.+)/,
              );
              if (remoteMatch?.[1]) {
                const url = remoteMatch[1].trim();
                // Handle git@host:org/repo.git or https://host/org/repo.git
                const repoName = url
                  .split('/')
                  .pop()
                  ?.replace(/\.git$/, '');
                if (repoName) name = repoName;
              }
            } catch {
              // fall back to folder name
            }
          }

          return Response.json({
            cancelled: false,
            path: dirPath,
            name,
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

    '/api/sessions/start': {
      async POST(req: Request) {
        try {
          const {
            sessionId,
            repoPath,
            prompt,
            model,
            permissionMode,
            resumeSdkSessionId,
          } = await req.json();
          if (!sessionId || !repoPath || !prompt) {
            return Response.json(
              { error: 'sessionId, repoPath, and prompt are required' },
              { status: 400 },
            );
          }
          if (getSession(sessionId)) {
            return Response.json(
              { error: 'Session already active' },
              { status: 409 },
            );
          }
          const result = await startSession({
            sessionId,
            repoPath,
            prompt,
            model,
            permissionMode,
            resumeSdkSessionId,
          });
          return Response.json(result);
        } catch (err) {
          console.error('Failed to start session:', err);
          return Response.json({ error: String(err) }, { status: 500 });
        }
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

    // SPA catch-all: serve the bundled app HTML for all unmatched GET routes.
    // Must be in `routes` (not `fetch`) so Bun serves the HTML *bundle* with
    // compiled asset paths (/_bun/...) rather than the raw source file.
    // Only match GET — POST/etc. must fall through to `fetch` for dynamic API routes.
    '/*': { GET: homepage },
  },

  async fetch(req, server) {
    const url = new URL(req.url);

    // POST /api/sessions/:id/stop
    const stopMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/stop$/);
    if (stopMatch && req.method === 'POST') {
      const sessionId = stopMatch[1];
      if (!sessionId) {
        return Response.json({ error: 'Missing session ID' }, { status: 400 });
      }
      try {
        stopSession(sessionId);
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Failed to stop session:', err);
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

    // POST /api/sessions/:id/respond — approve/deny a permission
    const respondMatch = url.pathname.match(/^\/api\/sessions\/(.+)\/respond$/);
    if (respondMatch && req.method === 'POST') {
      const sessionId = respondMatch[1];
      if (!sessionId) {
        return Response.json({ error: 'Missing session ID' }, { status: 400 });
      }
      try {
        const body = await req.json();
        const { requestId, approved, message } = body;
        if (!requestId || typeof approved !== 'boolean') {
          return Response.json(
            { error: 'requestId and approved (boolean) are required' },
            { status: 400 },
          );
        }
        const resolved = respondToApproval(
          sessionId,
          requestId,
          approved,
          message,
        );
        if (!resolved) {
          return Response.json(
            { error: 'No pending approval with that requestId' },
            { status: 404 },
          );
        }
        return Response.json({ ok: true });
      } catch (err) {
        console.error('Failed to respond to session:', err);
        return Response.json({ error: String(err) }, { status: 500 });
      }
    }

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

// On startup, mark any sessions left as 'running' (from a prior crash/restart)
// as 'idle' so users can resume them rather than seeing a broken state.
(async () => {
  const convexSiteUrl = process.env.CONVEX_SITE_URL;
  const secret = process.env.INTERNAL_API_SECRET;
  if (!convexSiteUrl || !secret) return;
  try {
    const res = await fetch(
      `${convexSiteUrl}/api/internal/sessions/markStaleRunning`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({}),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { count?: number };
      if (data.count && data.count > 0) {
        console.log(
          `Marked ${data.count} stale running session(s) as idle on startup.`,
        );
      }
    } else {
      console.error('Failed to mark stale sessions on startup:', res.status);
    }
  } catch (err) {
    console.error('Failed to mark stale sessions on startup:', err);
  }
})();

process.on('SIGINT', () => {
  server.stop();
  process.exit(0);
});
