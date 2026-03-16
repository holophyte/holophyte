// ── Auth token file utilities ────────────────────────────────────────
//
// Reads/writes the user auth token stored by `holophyte setup`.
// The companion uses this to authenticate as the logged-in user
// via ConvexClient.setAuth().

import { chmod, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TokenFileData {
  convexUrl: string;
  token: string;
  refreshToken: string;
}

const TOKEN_DIR = join(homedir(), '.holophyte');
const TOKEN_FILE = join(TOKEN_DIR, 'token.json');

export function getTokenFilePath(): string {
  return TOKEN_FILE;
}

/** Reads the token file. Returns null if missing or invalid. */
export async function readTokenFile(): Promise<TokenFileData | null> {
  try {
    const file = Bun.file(TOKEN_FILE);
    if (!(await file.exists())) return null;
    const data = await file.json();
    if (
      typeof data?.convexUrl !== 'string' ||
      typeof data?.token !== 'string' ||
      typeof data?.refreshToken !== 'string'
    ) {
      return null;
    }
    return data as TokenFileData;
  } catch {
    return null;
  }
}

/** Writes the token file with restricted permissions (0600). */
export async function writeTokenFile(data: TokenFileData): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true });
  await Bun.write(TOKEN_FILE, JSON.stringify(data, null, 2));
  await chmod(TOKEN_FILE, 0o600);
}

/**
 * Refreshes the auth token using the stored refresh token.
 * Calls the Convex `auth:signIn` action with the refresh token.
 * Updates the token file with the new tokens.
 *
 * Returns the new JWT or null if refresh failed.
 */
export async function refreshAuthToken(
  convexUrl: string,
  refreshToken: string,
): Promise<{ token: string; refreshToken: string } | null> {
  try {
    const res = await fetch(`${convexUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'auth:signIn',
        args: { refreshToken },
        format: 'json',
      }),
    });
    if (!res.ok) return null;
    const result = await res.json();
    if (!result?.value?.tokens) return null;
    return result.value.tokens;
  } catch {
    return null;
  }
}

/**
 * Creates an AuthTokenFetcher compatible with ConvexClient.setAuth().
 * Handles token refresh when forceRefreshToken is true.
 */
export function createFetchToken(
  tokenData: TokenFileData,
): (args: { forceRefreshToken: boolean }) => Promise<string | null> {
  let currentToken = tokenData.token;
  let currentRefreshToken = tokenData.refreshToken;
  let refreshPromise: Promise<string | null> | null = null;

  return async ({ forceRefreshToken }) => {
    if (!forceRefreshToken) return currentToken;

    // Serialize concurrent refresh requests
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
      try {
        const result = await refreshAuthToken(
          tokenData.convexUrl,
          currentRefreshToken,
        );
        if (!result) return null;

        currentToken = result.token;
        currentRefreshToken = result.refreshToken;

        // Persist updated tokens
        await writeTokenFile({
          convexUrl: tokenData.convexUrl,
          token: currentToken,
          refreshToken: currentRefreshToken,
        });

        return currentToken;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  };
}
