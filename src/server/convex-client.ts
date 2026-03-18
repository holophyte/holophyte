// ── Shared Convex client for companion ──────────────────────────────
//
// Creates and manages two clients:
// - ConvexClient (WebSocket) — for subscriptions + mutations
// - ConvexHttpClient (HTTP) — for one-shot queries
//
// Both are authenticated with the same JWT from the user's token file.

import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import type { TokenFileData } from './auth-token';
import { createFetchToken } from './auth-token';

let convexClient: ConvexClient | null = null;
let httpClient: ConvexHttpClient | null = null;

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

  // WebSocket client — subscriptions + mutations
  convexClient = new ConvexClient(convexUrl);
  convexClient.setAuth(createFetchToken(tokenFile));

  // HTTP client — one-shot queries
  httpClient = new ConvexHttpClient(convexUrl);
  httpClient.setAuth(tokenFile.token);

  console.log('Companion authenticated as user via stored token');
}

/** Returns the WebSocket-based ConvexClient for subscriptions and mutations. */
export function getConvexClient(): ConvexClient | null {
  return convexClient;
}

/** Returns the HTTP-based ConvexHttpClient for one-shot queries. */
export function getConvexHttpClient(): ConvexHttpClient | null {
  return httpClient;
}

/** Tears down both clients. Safe to call when clients are null. */
export function closeCompanionClients(): void {
  convexClient?.close().catch(console.error);
  convexClient = null;
  httpClient = null;
}
