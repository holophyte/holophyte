import {
  callConvexInternal,
  queryConvexInternal,
} from './server/convex-client';
import { startCompanionPolling, stopCompanionPolling } from './server/polling';
import {
  handleAuthProxy,
  handlePickDirectory,
  handlePickDirectoryCors,
} from './server/routes';

// ── Headless Companion Server ────────────────────────────────────────
// Runs the companion polling loop and local-only API routes without
// serving any frontend assets. Used in production (Vercel deployment)
// where the frontend is hosted separately.

const DEFAULT_ALLOWED_ORIGIN = 'https://holophyte.vercel.app';
if (!process.env.ALLOWED_ORIGIN) {
  process.env.ALLOWED_ORIGIN = DEFAULT_ALLOWED_ORIGIN;
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 0,
  routes: {
    '/api/auth/*': async (req: Request) => handleAuthProxy(req),

    '/api/pick-directory': {
      async POST(req: Request) {
        return handlePickDirectory(req);
      },
      OPTIONS(req: Request) {
        return handlePickDirectoryCors(req);
      },
    },
  },

  fetch(_req: Request) {
    return new Response('Not Found', { status: 404 });
  },
});

const url = `http://localhost:${server.port}`;
console.log(`Holophyte companion running on ${url}`);
console.log(`  Convex URL: ${process.env.CONVEX_URL || '(not set)'}`);
console.log(`  Convex Site: ${process.env.CONVEX_SITE_URL || '(not set)'}`);
console.log(`  Allowed Origin: ${process.env.ALLOWED_ORIGIN}`);

// Startup sequence: duplicate check → session cleanup → polling start.
// All three steps talk to Convex; missing config is non-fatal for each.
const DUPLICATE_THRESHOLD_MS = 10_000;

(async () => {
  // 1. Detect duplicate companion instances. If another companion is actively
  //    heartbeating against this deployment, exit rather than running two in
  //    parallel against the same database.
  try {
    const status = await queryConvexInternal<{
      lastSeen: number;
      machineId?: string;
    } | null>('/api/internal/companion/status', {});
    if (status && Date.now() - status.lastSeen < DUPLICATE_THRESHOLD_MS) {
      const secondsAgo = Math.round((Date.now() - status.lastSeen) / 1000);
      console.error(
        `Error: Another companion is already connected to this deployment (last seen ${secondsAgo}s ago).\n` +
          `Stop it first, or check your CONVEX_DEPLOYMENT config.`,
      );
      process.exit(1);
    }
  } catch {
    // Non-critical — skip check if Convex is not configured yet
  }

  // 2. Clean up sessions left in inconsistent states from a prior crash or
  //    companion outage:
  //      - 'running' → 'idle': process died without finalising the turn
  //      - 'stopped' → 'idle': stop request was never processed
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

  // 3. Start the polling loop for queued/stopped sessions.
  startCompanionPolling({ url });
})();

function shutdown() {
  stopCompanionPolling();
  server.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
