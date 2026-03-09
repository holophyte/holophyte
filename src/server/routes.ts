import { exists } from 'node:fs/promises';
import { basename } from 'node:path';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function handlePickDirectoryCors(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function handlePickDirectory(): Promise<Response> {
  try {
    if (process.platform !== 'darwin') {
      return Response.json(
        { error: 'Directory picker only supported on macOS' },
        { status: 501, headers: CORS_HEADERS },
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
      return Response.json({ cancelled: true }, { headers: CORS_HEADERS });
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
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    console.error('Failed to open directory picker:', err);
    return Response.json(
      { error: 'Failed to open directory picker.' },
      { status: 500, headers: CORS_HEADERS },
    );
  }
}

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
