// ── Convex internal API helpers ──────────────────────────────────────

/** Whether a startup warning about missing config has already been logged. */
let configWarningLogged = false;

export function getConvexConfig() {
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
export async function callConvexInternal(
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

export async function queryConvexInternal<T>(
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
