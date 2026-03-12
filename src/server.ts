import homepage from '../public/index.html';
import { callConvexInternal } from './server/convex-client';
import { startCompanionPolling, stopCompanionPolling } from './server/polling';
import {
  handleAuthProxy,
  handlePickDirectory,
  handlePickDirectoryCors,
} from './server/routes';

// ── HTTP Server ──────────────────────────────────────────────────────

const server = Bun.serve({
  port: Number(process.env.PORT) || 8080,
  routes: {
    '/': homepage,

    // Serves app config as a JS global, loaded by <script src="/config.js">
    // in index.html. This replaces env vars which aren't available in browser.
    '/config.js': {
      GET() {
        const config = {
          convexUrl: (process.env.CONVEX_URL ?? '').replace(/\/+$/, ''),
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
    '/api/auth/*': async (req: Request) => handleAuthProxy(req),

    '/api/pick-directory': {
      async POST(req: Request) {
        return handlePickDirectory(req);
      },
      OPTIONS(req: Request) {
        return handlePickDirectoryCors(req);
      },
    },

    // SPA catch-all: serve the bundled app HTML for all unmatched GET routes.
    // Must be in `routes` (not `fetch`) so Bun serves the HTML *bundle* with
    // compiled asset paths (/_bun/...) rather than the raw source file.
    '/*': homepage,
  },

  fetch(_req: Request) {
    return new Response('Not Found', { status: 404 });
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
startCompanionPolling({ url: `http://localhost:${server.port}` });

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

function shutdown() {
  stopCompanionPolling();
  server.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
