import { startCompanion, stopCompanionPolling } from './server/polling';
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
console.log(`  Allowed Origin: ${process.env.ALLOWED_ORIGIN}`);

void startCompanion(url);

function shutdown() {
  stopCompanionPolling();
  server.stop();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
