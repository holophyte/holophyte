// ── Auth token file utilities ────────────────────────────────────────
//
// Reads/writes the user auth token stored by `holophyte setup`.
// The companion uses this to authenticate as the logged-in user
// via ConvexClient.setAuth().

import { mkdir, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TokenFileData {
  convexUrl: string;
  token: string;
  refreshToken: string;
  /** True for anonymous tokens — should not be persisted to disk. */
  ephemeral?: boolean;
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
    // Validate convexUrl is a well-formed HTTPS URL (or localhost for dev)
    try {
      const url = new URL(data.convexUrl);
      if (
        url.protocol !== 'https:' &&
        url.hostname !== 'localhost' &&
        url.hostname !== '127.0.0.1'
      ) {
        console.error(
          'Token file has invalid convexUrl — must be HTTPS or localhost',
        );
        return null;
      }
    } catch {
      console.error('Token file has malformed convexUrl');
      return null;
    }
    return data as TokenFileData;
  } catch {
    return null;
  }
}

/** Writes the token file atomically with restricted permissions (0600). */
export async function writeTokenFile(data: TokenFileData): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });
  // Write to a temp file with restricted permissions, then atomically rename
  const tmpFile = `${TOKEN_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(tmpFile, TOKEN_FILE);
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
    if (!res.ok) {
      console.error(`Auth token refresh failed (${res.status})`);
      return null;
    }
    const result = await res.json();
    if (!result?.value?.tokens) {
      console.error('Auth token refresh returned no tokens');
      return null;
    }
    return result.value.tokens;
  } catch (err) {
    console.error('Auth token refresh error:', err);
    return null;
  }
}

/**
 * Signs in anonymously to get a valid JWT.
 * Used as a fallback when no token file exists and ALLOW_ANONYMOUS_AUTH is enabled
 * (local dev / E2E tests with ephemeral Convex instances).
 *
 * Does NOT write to disk — anonymous tokens are ephemeral.
 */
export async function signInAnonymous(
  convexUrl: string,
): Promise<TokenFileData | null> {
  try {
    const res = await fetch(`${convexUrl}/api/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: 'auth:signIn',
        args: { provider: 'anonymous' },
        format: 'json',
      }),
    });
    if (!res.ok) {
      console.error(`Anonymous sign-in failed (${res.status})`);
      return null;
    }
    const result = await res.json();
    if (!result?.value?.tokens) {
      console.error('Anonymous sign-in returned no tokens');
      return null;
    }
    const { token, refreshToken } = result.value.tokens;
    if (typeof token !== 'string' || typeof refreshToken !== 'string') {
      console.error('Anonymous sign-in returned invalid token fields');
      return null;
    }
    return { convexUrl, token, refreshToken, ephemeral: true };
  } catch (err) {
    console.error('Anonymous sign-in error:', err);
    return null;
  }
}

/**
 * Creates an AuthTokenFetcher compatible with ConvexClient.setAuth().
 * Handles token refresh when forceRefreshToken is true.
 *
 * When `ephemeral` is true, refreshed tokens are NOT persisted to disk.
 * Used for anonymous auth tokens that should not overwrite the user's token file.
 */
export function createFetchToken(
  tokenData: TokenFileData,
  opts?: { ephemeral?: boolean },
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

        // Persist updated tokens (skip for ephemeral/anonymous tokens)
        if (!opts?.ephemeral) {
          await writeTokenFile({
            convexUrl: tokenData.convexUrl,
            token: currentToken,
            refreshToken: currentRefreshToken,
          });
        }

        return currentToken;
      } finally {
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  };
}
