/**
 * Local-only HTTP route handlers for the companion server.
 *
 * These routes require access to the local machine (filesystem, macOS dialogs)
 * and cannot run in Convex. CORS is restricted to `ALLOWED_ORIGIN` when set.
 */
import { exists } from 'node:fs/promises';
import { basename } from 'node:path';

/** Build CORS headers that only allow the origin specified in `ALLOWED_ORIGIN` env var. Returns `Vary: Origin` always for caching correctness. */
function corsOriginHeaders(req?: Request): Record<string, string> {
  const allowedOrigin = process.env.ALLOWED_ORIGIN ?? '';
  const requestOrigin = req?.headers.get('Origin') ?? '';
  const matched =
    allowedOrigin && requestOrigin === allowedOrigin ? allowedOrigin : null;
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (matched) {
    headers['Access-Control-Allow-Origin'] = matched;
  }
  return headers;
}

/** CORS preflight handler for the directory picker endpoint. */
export function handlePickDirectoryCors(req: Request): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsOriginHeaders(req),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

/**
 * Open a native macOS folder picker dialog and return the selected path.
 * Returns `{ cancelled: true }` if the user dismisses the dialog,
 * or `{ path, name, isGitRepo }` on success. macOS-only (501 on other platforms).
 */
export async function handlePickDirectory(req: Request): Promise<Response> {
  const headers = corsOriginHeaders(req);
  try {
    if (process.platform !== 'darwin') {
      return Response.json(
        { error: 'Directory picker only supported on macOS' },
        { status: 501, headers },
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
      return Response.json({ cancelled: true }, { headers });
    }
    const raw = await new Response(proc.stdout).text();
    const dirPath = raw.trim().replace(/\/$/, '');

    const isGitRepo = await exists(`${dirPath}/.git`);

    return Response.json(
      {
        cancelled: false,
        path: dirPath,
        name: basename(dirPath),
        isGitRepo,
      },
      { headers },
    );
  } catch (err) {
    console.error('Failed to open directory picker:', err);
    return Response.json(
      { error: 'Failed to open directory picker.' },
      { status: 500, headers },
    );
  }
}

/**
 * Proxy `/api/auth/*` requests to Convex's site URL for OAuth callback handling.
 * GitHub/Google redirect to the app port, and this forwards the request to
 * Convex HTTP actions to complete the OAuth flow.
 */
export async function handleAuthProxy(req: Request): Promise<Response> {
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
}
