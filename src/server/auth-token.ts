// ── Auth token file utilities ────────────────────────────────────────
//
// Reads/writes user auth tokens stored by `holophyte setup`.
// Tokens are keyed by CONVEX_DEPLOYMENT in ~/.holophyte/tokens.json
// so multiple environments (local, dev, prod) can coexist.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface TokenFileData {
  convexUrl: string;
  token: string;
  refreshToken: string;
  /** True for anonymous tokens — should not be persisted to disk. */
  ephemeral?: boolean;
}

/** On-disk entry in tokens.json — extends TokenFileData with metadata. */
export interface TokenEntry {
  environment: string;
  convexUrl: string;
  token: string;
  refreshToken: string;
  updatedAt: string;
}

/** Deployment-keyed map stored in tokens.json. */
export type TokensFile = Record<string, TokenEntry>;

/** Discriminated result from readTokenFile — distinguishes missing vs corrupt. */
export type TokenReadResult =
  | { status: 'missing' }
  | { status: 'invalid'; reason: string }
  | { status: 'ok'; data: TokenFileData };

const TOKEN_DIR = join(homedir(), '.holophyte');
/** Legacy single-token file path (pre-migration). */
const LEGACY_TOKEN_FILE = join(TOKEN_DIR, 'token.json');
/** Current deployment-keyed token file path. */
const TOKENS_FILE = join(TOKEN_DIR, 'tokens.json');

export function getTokensFilePath(): string {
  return TOKENS_FILE;
}

/**
 * Derives a human-readable environment label from a CONVEX_DEPLOYMENT value.
 *
 * Deployment format:
 * - `prod:handsome-marmot-XXX` → "production"
 * - `dev:some-name` → "development"
 * - `local-ko_vial-holophyte-9133` → "local"
 */
export function deriveEnvironment(deployment: string): string {
  if (deployment.startsWith('prod:')) return 'production';
  if (deployment.startsWith('dev:')) return 'development';
  if (deployment.startsWith('local-') || deployment.startsWith('local:'))
    return 'local';
  return 'unknown';
}

/** Validates that a convexUrl is HTTPS or localhost. Returns a reason string on failure. */
function validateConvexUrl(convexUrl: string): string | null {
  try {
    const url = new URL(convexUrl);
    if (
      url.protocol !== 'https:' &&
      url.hostname !== 'localhost' &&
      url.hostname !== '127.0.0.1'
    ) {
      return 'convexUrl must be HTTPS or localhost';
    }
    return null;
  } catch {
    return 'convexUrl is malformed';
  }
}

/**
 * Silently migrates legacy `token.json` into `tokens.json` under the
 * given deployment key, then deletes the legacy file.
 */
async function migrateLegacyTokenFile(
  deployment: string,
): Promise<TokenReadResult> {
  try {
    const legacyFile = Bun.file(LEGACY_TOKEN_FILE);
    let data: unknown;
    try {
      data = await legacyFile.json();
    } catch {
      return {
        status: 'invalid',
        reason: 'Legacy token file contains invalid JSON',
      };
    }

    if (
      typeof data !== 'object' ||
      data === null ||
      typeof (data as Record<string, unknown>).convexUrl !== 'string' ||
      typeof (data as Record<string, unknown>).token !== 'string' ||
      typeof (data as Record<string, unknown>).refreshToken !== 'string'
    ) {
      return {
        status: 'invalid',
        reason: 'Legacy token file is missing required fields',
      };
    }

    const d = data as Record<string, string>;
    const urlError = validateConvexUrl(d.convexUrl as string);
    if (urlError) {
      return { status: 'invalid', reason: `Legacy token: ${urlError}` };
    }

    const tokenData: TokenFileData = {
      convexUrl: d.convexUrl as string,
      token: d.token as string,
      refreshToken: d.refreshToken as string,
    };

    // Write to new format and remove legacy file
    await writeTokenFile(deployment, tokenData);
    await unlink(LEGACY_TOKEN_FILE);
    console.log('Migrated ~/.holophyte/token.json → tokens.json');

    return { status: 'ok', data: tokenData };
  } catch {
    return {
      status: 'invalid',
      reason: 'Failed to migrate legacy token file',
    };
  }
}

/**
 * Reads the token for a specific deployment from tokens.json.
 *
 * Returns a discriminated result:
 * - `{ status: 'missing' }` — no entry for this deployment
 * - `{ status: 'invalid', reason }` — entry exists but is corrupt
 * - `{ status: 'ok', data }` — valid token data
 *
 * On first call, migrates legacy token.json if it exists.
 */
export async function readTokenFile(
  deployment: string,
): Promise<TokenReadResult> {
  try {
    const tokensFile = Bun.file(TOKENS_FILE);

    // Check for legacy migration
    if (!(await tokensFile.exists())) {
      const legacyFile = Bun.file(LEGACY_TOKEN_FILE);
      if (await legacyFile.exists()) {
        return migrateLegacyTokenFile(deployment);
      }
      return { status: 'missing' };
    }

    // Read tokens.json
    let allTokens: unknown;
    try {
      allTokens = await tokensFile.json();
    } catch {
      return { status: 'invalid', reason: 'Token file contains invalid JSON' };
    }

    if (typeof allTokens !== 'object' || allTokens === null) {
      return { status: 'invalid', reason: 'Token file is not a JSON object' };
    }

    const entry = (allTokens as Record<string, unknown>)[deployment];
    if (!entry) {
      return { status: 'missing' };
    }

    // Validate entry shape
    if (typeof entry !== 'object' || entry === null) {
      return {
        status: 'invalid',
        reason: `Entry for ${deployment} is not an object`,
      };
    }

    const e = entry as Record<string, unknown>;
    if (
      typeof e.convexUrl !== 'string' ||
      typeof e.token !== 'string' ||
      typeof e.refreshToken !== 'string'
    ) {
      return {
        status: 'invalid',
        reason: `Entry for ${deployment} is missing required fields`,
      };
    }

    const urlError = validateConvexUrl(e.convexUrl as string);
    if (urlError) {
      return { status: 'invalid', reason: urlError };
    }

    return {
      status: 'ok',
      data: {
        convexUrl: e.convexUrl as string,
        token: e.token as string,
        refreshToken: e.refreshToken as string,
      },
    };
  } catch {
    return { status: 'invalid', reason: 'Failed to read token file' };
  }
}

/**
 * Writes a token entry for the given deployment to tokens.json.
 * Reads existing entries and merges, then writes atomically.
 */
export async function writeTokenFile(
  deployment: string,
  data: TokenFileData,
): Promise<void> {
  await mkdir(TOKEN_DIR, { recursive: true, mode: 0o700 });

  // Read existing tokens map
  let allTokens: TokensFile = {};
  try {
    const file = Bun.file(TOKENS_FILE);
    if (await file.exists()) {
      allTokens = (await file.json()) as TokensFile;
    }
  } catch {
    // Start fresh if file is corrupt
  }

  // Update the entry for this deployment
  allTokens[deployment] = {
    environment: deriveEnvironment(deployment),
    convexUrl: data.convexUrl,
    token: data.token,
    refreshToken: data.refreshToken,
    updatedAt: new Date().toISOString(),
  };

  // Atomic write
  const tmpFile = `${TOKENS_FILE}.tmp`;
  await writeFile(tmpFile, JSON.stringify(allTokens, null, 2), {
    mode: 0o600,
  });
  await rename(tmpFile, TOKENS_FILE);
}

/**
 * Refreshes the auth token using the stored refresh token.
 * Calls the Convex `auth:signIn` action with the refresh token.
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
    const tokens = result.value.tokens;
    if (
      typeof tokens.token !== 'string' ||
      typeof tokens.refreshToken !== 'string'
    ) {
      console.error('Auth token refresh returned invalid token fields');
      return null;
    }
    return { token: tokens.token, refreshToken: tokens.refreshToken };
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
 * When `tokenData.ephemeral` is true, refreshed tokens are NOT persisted to disk.
 * Used for anonymous auth tokens that should not overwrite the user's token file.
 */
export function createFetchToken(
  deployment: string,
  tokenData: TokenFileData,
): (args: { forceRefreshToken: boolean }) => Promise<string | null> {
  const isEphemeral = tokenData.ephemeral ?? false;
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

        if (isEphemeral) {
          // Keep tokenData in sync so callers holding a reference see
          // the rotated values (ephemeral tokens skip disk persistence).
          tokenData.token = currentToken;
          tokenData.refreshToken = currentRefreshToken;
        } else {
          await writeTokenFile(deployment, {
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
