// ── Shared Convex client for companion ──────────────────────────────
//
// Creates and manages two clients:
// - ConvexClient (WebSocket) — for subscriptions + mutations
// - ConvexHttpClient (HTTP) — for one-shot queries
//
// Both are authenticated with the same JWT from the user's token file.
// The token fetcher is shared so the HTTP client picks up tokens
// refreshed by the WebSocket client.

import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import type { TokenFileData } from './auth-token';
import { createFetchToken } from './auth-token';

let convexClient: ConvexClient | null = null;
let httpClient: ConvexHttpClient | null = null;
/** Shared token fetcher — ConvexClient refreshes it, httpClient reads it. */
let fetchToken:
  | ((args: { forceRefreshToken: boolean }) => Promise<string | null>)
  | null = null;

/**
 * Creates and authenticates both Convex clients.
 *
 * Call once during companion startup, before subscriptions or polling begin.
 * Safe to call again after `closeCompanionClients()` (e.g. on token refresh).
 */
export function initCompanionClients(
  convexUrl: string,
  tokenFile: TokenFileData,
): void {
  // Validate token matches deployment before opening connections
  const normalize = (u: string) => u.replace(/\/$/, '');
  if (normalize(tokenFile.convexUrl) !== normalize(convexUrl)) {
    throw new Error(
      `Token is for ${tokenFile.convexUrl}, not ${convexUrl}. Run \`bun run setup\` to re-authenticate.`,
    );
  }

  // Close existing clients to avoid leaking WebSocket connections
  if (convexClient) {
    convexClient.close().catch(console.error);
  }

  // Shared token fetcher — ConvexClient's periodic refresh updates the
  // token in the closure; getConvexHttpClient() re-sets it before each use.
  fetchToken = createFetchToken(tokenFile);

  // WebSocket client — subscriptions + mutations (auto-refreshes tokens)
  convexClient = new ConvexClient(convexUrl);
  convexClient.setAuth(fetchToken);

  // HTTP client — one-shot queries (token refreshed before each use)
  httpClient = new ConvexHttpClient(convexUrl);
  httpClient.setAuth(tokenFile.token);

  console.log('Companion authenticated as user via stored token');
}

/** Returns the WebSocket-based ConvexClient for subscriptions and mutations. */
export function getConvexClient(): ConvexClient | null {
  return convexClient;
}

/**
 * Returns the HTTP-based ConvexHttpClient for one-shot queries.
 *
 * Refreshes the auth token from the shared fetcher before returning, so
 * tokens refreshed by the WebSocket client are picked up automatically.
 * ConvexHttpClient.setAuth() only takes a string (no fetcher callback),
 * so we bridge the gap here.
 */
export async function getConvexHttpClient(): Promise<ConvexHttpClient | null> {
  if (!httpClient || !fetchToken) return null;
  // Get the latest token (already refreshed by ConvexClient if needed)
  const token = await fetchToken({ forceRefreshToken: false });
  if (!token) return null;
  httpClient.setAuth(token);
  return httpClient;
}

/** Tears down both clients. Safe to call when clients are null. */
export function closeCompanionClients(): void {
  convexClient?.close().catch(console.error);
  convexClient = null;
  httpClient = null;
  fetchToken = null;
}
