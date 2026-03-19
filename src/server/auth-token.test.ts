// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs/promises before importing the module under test
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';

// Set up Bun global mock before importing the module
const mockBunFile = vi.fn();
const mockBunWrite = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('Bun', {
  file: mockBunFile,
  write: mockBunWrite,
});

import {
  createFetchToken,
  deriveEnvironment,
  getTokensFilePath,
  readTokenFile,
  refreshAuthToken,
  signInAnonymous,
  type TokenFileData,
  writeTokenFile,
} from './auth-token';

const TEST_DEPLOYMENT = 'prod:handsome-marmot-123';

const validTokenData: TokenFileData = {
  convexUrl: 'https://example.convex.cloud',
  token: 'jwt-token-abc',
  refreshToken: 'refresh-token-xyz',
};

function makeMockFile(options: {
  exists: boolean;
  json?: () => Promise<unknown>;
}) {
  return {
    exists: vi.fn().mockResolvedValue(options.exists),
    json: options.json ?? vi.fn().mockResolvedValue(null),
  };
}

/**
 * Sets up mockBunFile to return different mock files based on the path.
 * Matches on filename suffix (e.g. 'tokens.json', 'token.json').
 */
function setupMockFiles(
  files: Record<string, ReturnType<typeof makeMockFile>>,
) {
  mockBunFile.mockImplementation((path: string) => {
    for (const [suffix, mock] of Object.entries(files)) {
      if (path.endsWith(suffix)) return mock;
    }
    return makeMockFile({ exists: false });
  });
}

describe('getTokensFilePath', () => {
  it('returns a path ending in .holophyte/tokens.json', () => {
    const path = getTokensFilePath();
    expect(path).toMatch(/\.holophyte[/\\]tokens\.json$/);
  });
});

describe('deriveEnvironment', () => {
  it('returns "production" for prod: prefix', () => {
    expect(deriveEnvironment('prod:handsome-marmot-123')).toBe('production');
  });

  it('returns "development" for dev: prefix', () => {
    expect(deriveEnvironment('dev:some-name')).toBe('development');
  });

  it('returns "local" for local- prefix', () => {
    expect(deriveEnvironment('local-ko_vial-holophyte-9133')).toBe('local');
  });

  it('returns "local" for local: prefix', () => {
    expect(deriveEnvironment('local:something')).toBe('local');
  });

  it('returns "unknown" for unrecognized prefixes', () => {
    expect(deriveEnvironment('staging:foo')).toBe('unknown');
  });
});

describe('readTokenFile', () => {
  beforeEach(() => {
    mockBunFile.mockReset();
    mockBunWrite.mockReset().mockResolvedValue(undefined);
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(rename).mockReset().mockResolvedValue(undefined);
    vi.mocked(unlink).mockReset().mockResolvedValue(undefined);
  });

  it('returns missing when neither tokens.json nor token.json exists', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
      'token.json': makeMockFile({ exists: false }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({ status: 'missing' });
  });

  it('returns invalid when tokens.json contains bad JSON', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({
      status: 'invalid',
      reason: 'Token file contains invalid JSON',
    });
  });

  it('returns missing when tokens.json exists but has no entry for the deployment', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({ 'other-deployment': {} }),
      }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({ status: 'missing' });
  });

  it('returns invalid when the deployment entry is missing required fields', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          [TEST_DEPLOYMENT]: { convexUrl: 'https://example.com' },
        }),
      }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({
      status: 'invalid',
      reason: `Entry for ${TEST_DEPLOYMENT} is missing required fields`,
    });
  });

  it('returns invalid when convexUrl is not HTTPS or localhost', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          [TEST_DEPLOYMENT]: {
            convexUrl: 'http://evil.com',
            token: 'jwt',
            refreshToken: 'refresh',
          },
        }),
      }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({
      status: 'invalid',
      reason: 'convexUrl must be HTTPS or localhost',
    });
  });

  it('returns ok with parsed data for a valid entry', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          [TEST_DEPLOYMENT]: {
            ...validTokenData,
            environment: 'production',
            updatedAt: '2026-03-18T00:00:00Z',
          },
        }),
      }),
    });

    const result = await readTokenFile(TEST_DEPLOYMENT);

    expect(result).toEqual({ status: 'ok', data: validTokenData });
  });

  it('accepts localhost convexUrl for local deployments', async () => {
    const localDeployment = 'local-ko_vial-holophyte-9133';
    const localTokenData = {
      convexUrl: 'http://127.0.0.1:3210',
      token: 'local-jwt',
      refreshToken: 'local-refresh',
    };

    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          [localDeployment]: {
            ...localTokenData,
            environment: 'local',
            updatedAt: '2026-03-18T00:00:00Z',
          },
        }),
      }),
    });

    const result = await readTokenFile(localDeployment);

    expect(result).toEqual({ status: 'ok', data: localTokenData });
  });

  describe('legacy migration', () => {
    it('migrates token.json into tokens.json when tokens.json does not exist', async () => {
      setupMockFiles({
        'tokens.json': makeMockFile({ exists: false }),
        'token.json': makeMockFile({
          exists: true,
          json: vi.fn().mockResolvedValue({ ...validTokenData }),
        }),
      });

      const result = await readTokenFile(TEST_DEPLOYMENT);

      expect(result).toEqual({ status: 'ok', data: validTokenData });
      // Should have written tokens.json
      expect(writeFile).toHaveBeenCalled();
      // Should have deleted legacy file
      expect(unlink).toHaveBeenCalled();
    });

    it('returns invalid when legacy token.json has bad data', async () => {
      setupMockFiles({
        'tokens.json': makeMockFile({ exists: false }),
        'token.json': makeMockFile({
          exists: true,
          json: vi.fn().mockResolvedValue({ convexUrl: 'https://example.com' }),
        }),
      });

      const result = await readTokenFile(TEST_DEPLOYMENT);

      expect(result).toEqual({
        status: 'invalid',
        reason: 'Legacy token file is missing required fields',
      });
    });
  });
});

describe('writeTokenFile', () => {
  beforeEach(() => {
    mockBunFile.mockReset();
    mockBunWrite.mockReset().mockResolvedValue(undefined);
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(rename).mockReset().mockResolvedValue(undefined);
  });

  it('creates the token directory with recursive flag and 0700', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    await writeTokenFile(TEST_DEPLOYMENT, validTokenData);

    expect(mkdir).toHaveBeenCalledWith(expect.stringMatching(/\.holophyte$/), {
      recursive: true,
      mode: 0o700,
    });
  });

  it('writes a deployment-keyed entry with environment and updatedAt', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    await writeTokenFile(TEST_DEPLOYMENT, validTokenData);

    const writtenJson = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed[TEST_DEPLOYMENT]).toMatchObject({
      environment: 'production',
      convexUrl: validTokenData.convexUrl,
      token: validTokenData.token,
      refreshToken: validTokenData.refreshToken,
    });
    expect(parsed[TEST_DEPLOYMENT].updatedAt).toBeDefined();
  });

  it('merges with existing entries when tokens.json already has data', async () => {
    const existingEntry = {
      'other-deployment': {
        environment: 'local',
        convexUrl: 'http://localhost:3210',
        token: 'other-jwt',
        refreshToken: 'other-refresh',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    };

    setupMockFiles({
      'tokens.json': makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue(existingEntry),
      }),
    });

    await writeTokenFile(TEST_DEPLOYMENT, validTokenData);

    const writtenJson = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenJson);
    // Existing entry preserved
    expect(parsed['other-deployment']).toBeDefined();
    // New entry added
    expect(parsed[TEST_DEPLOYMENT]).toBeDefined();
  });

  it('atomically renames temp file to final path', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    await writeTokenFile(TEST_DEPLOYMENT, validTokenData);

    expect(rename).toHaveBeenCalledWith(
      `${getTokensFilePath()}.tmp`,
      getTokensFilePath(),
    );
  });

  it('writes with restricted permissions (0600)', async () => {
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    await writeTokenFile(TEST_DEPLOYMENT, validTokenData);

    expect(writeFile).toHaveBeenCalledWith(
      `${getTokensFilePath()}.tmp`,
      expect.any(String),
      { mode: 0o600 },
    );
  });
});

describe('refreshAuthToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('calls the correct Convex API endpoint', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          value: { tokens: { token: 'new-jwt', refreshToken: 'new-refresh' } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await refreshAuthToken('https://example.convex.cloud', 'refresh-token-xyz');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.convex.cloud/api/action',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'auth:signIn',
          args: { refreshToken: 'refresh-token-xyz' },
          format: 'json',
        }),
      }),
    );
  });

  it('returns new tokens on success', async () => {
    const newTokens = { token: 'new-jwt', refreshToken: 'new-refresh' };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await refreshAuthToken(
      'https://example.convex.cloud',
      'refresh-token-xyz',
    );

    expect(result).toEqual(newTokens);
  });

  it('returns null when the response is not ok', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 401 }));

    const result = await refreshAuthToken(
      'https://example.convex.cloud',
      'bad-refresh',
    );

    expect(result).toBeNull();
  });

  it('returns null when tokens are missing from the response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await refreshAuthToken(
      'https://example.convex.cloud',
      'refresh',
    );

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('Network error'));

    const result = await refreshAuthToken(
      'https://example.convex.cloud',
      'refresh',
    );

    expect(result).toBeNull();
  });
});

describe('signInAnonymous', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('calls the correct Convex API endpoint with anonymous provider', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          value: {
            tokens: { token: 'anon-jwt', refreshToken: 'anon-refresh' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await signInAnonymous('http://localhost:3210');

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3210/api/action',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: 'auth:signIn',
          args: { provider: 'anonymous' },
          format: 'json',
        }),
      }),
    );
  });

  it('returns TokenFileData on success', async () => {
    fetchSpy.mockResolvedValue(
      new Response(
        JSON.stringify({
          value: {
            tokens: { token: 'anon-jwt', refreshToken: 'anon-refresh' },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await signInAnonymous('http://localhost:3210');

    expect(result).toEqual({
      convexUrl: 'http://localhost:3210',
      token: 'anon-jwt',
      refreshToken: 'anon-refresh',
      ephemeral: true,
    });
  });

  it('returns null when the response is not ok', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

    const result = await signInAnonymous('http://localhost:3210');

    expect(result).toBeNull();
  });

  it('returns null when tokens are missing from the response', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await signInAnonymous('http://localhost:3210');

    expect(result).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchSpy.mockRejectedValue(new Error('Connection refused'));

    const result = await signInAnonymous('http://localhost:3210');

    expect(result).toBeNull();
  });
});

describe('createFetchToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockBunFile.mockReset();
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(rename).mockReset().mockResolvedValue(undefined);
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns current token when forceRefreshToken is false', async () => {
    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);

    const token = await fetchToken({ forceRefreshToken: false });

    expect(token).toBe(validTokenData.token);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('calls refreshAuthToken when forceRefreshToken is true', async () => {
    const newTokens = {
      token: 'refreshed-jwt',
      refreshToken: 'refreshed-refresh',
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    // Mock for writeTokenFile's read of existing tokens.json
    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);
    const token = await fetchToken({ forceRefreshToken: true });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(token).toBe('refreshed-jwt');
  });

  it('returns new token on subsequent calls after refresh', async () => {
    const newTokens = {
      token: 'refreshed-jwt',
      refreshToken: 'refreshed-refresh',
    };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);
    await fetchToken({ forceRefreshToken: true });

    // After refresh, forceRefreshToken:false should return the new token
    const token = await fetchToken({ forceRefreshToken: false });
    expect(token).toBe('refreshed-jwt');
  });

  it('serializes concurrent refresh requests to a single API call', async () => {
    const newTokens = {
      token: 'refreshed-jwt',
      refreshToken: 'refreshed-refresh',
    };

    // Use a delayed response so the second call arrives while the first is in-flight
    fetchSpy.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ value: { tokens: newTokens } }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
              ),
            10,
          );
        }),
    );

    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);

    // Fire two concurrent refresh calls
    const [result1, result2] = await Promise.all([
      fetchToken({ forceRefreshToken: true }),
      fetchToken({ forceRefreshToken: true }),
    ]);

    // Only one fetch call should have been made
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result1).toBe('refreshed-jwt');
    expect(result2).toBe('refreshed-jwt');
  });

  it('persists updated tokens to tokens.json after a successful refresh', async () => {
    const newTokens = { token: 'new-jwt', refreshToken: 'new-refresh' };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);
    await fetchToken({ forceRefreshToken: true });

    // Should have written to tokens.json.tmp
    expect(writeFile).toHaveBeenCalledWith(
      `${getTokensFilePath()}.tmp`,
      expect.any(String),
      { mode: 0o600 },
    );

    // Verify the written content contains the deployment-keyed entry
    const writtenJson = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed[TEST_DEPLOYMENT]).toMatchObject({
      convexUrl: validTokenData.convexUrl,
      token: 'new-jwt',
      refreshToken: 'new-refresh',
    });
  });

  it('returns null when refresh fails', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);
    const token = await fetchToken({ forceRefreshToken: true });

    expect(token).toBeNull();
  });

  it('clears the in-flight promise after refresh completes, allowing a second refresh', async () => {
    const firstTokens = { token: 'first-jwt', refreshToken: 'first-refresh' };
    const secondTokens = {
      token: 'second-jwt',
      refreshToken: 'second-refresh',
    };

    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: { tokens: firstTokens } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: { tokens: secondTokens } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    setupMockFiles({
      'tokens.json': makeMockFile({ exists: false }),
    });

    const fetchToken = createFetchToken(TEST_DEPLOYMENT, validTokenData);

    const token1 = await fetchToken({ forceRefreshToken: true });
    const token2 = await fetchToken({ forceRefreshToken: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(token1).toBe('first-jwt');
    expect(token2).toBe('second-jwt');
  });

  it('does not persist tokens to disk when ephemeral is true', async () => {
    const newTokens = { token: 'new-jwt', refreshToken: 'new-refresh' };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const ephemeralToken = { ...validTokenData, ephemeral: true as const };
    const fetchToken = createFetchToken(TEST_DEPLOYMENT, ephemeralToken);
    await fetchToken({ forceRefreshToken: true });

    expect(writeFile).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('syncs rotated tokens back to tokenData on refresh', async () => {
    const newTokens = { token: 'rotated-jwt', refreshToken: 'rotated-refresh' };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const tokenData = { ...validTokenData, ephemeral: true as const };
    const fetchToken = createFetchToken(TEST_DEPLOYMENT, tokenData);
    await fetchToken({ forceRefreshToken: true });

    expect(tokenData.token).toBe('rotated-jwt');
    expect(tokenData.refreshToken).toBe('rotated-refresh');
  });
});
