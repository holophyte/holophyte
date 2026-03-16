// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock node:fs/promises before importing the module under test
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
}));

import { mkdir, rename, writeFile } from 'node:fs/promises';

// Set up Bun global mock before importing the module
const mockBunFile = vi.fn();
const mockBunWrite = vi.fn().mockResolvedValue(undefined);

vi.stubGlobal('Bun', {
  file: mockBunFile,
  write: mockBunWrite,
});

import {
  createFetchToken,
  getTokenFilePath,
  readTokenFile,
  refreshAuthToken,
  type TokenFileData,
  writeTokenFile,
} from './auth-token';

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

describe('getTokenFilePath', () => {
  it('returns a path ending in .holophyte/token.json', () => {
    const path = getTokenFilePath();
    expect(path).toMatch(/\.holophyte[/\\]token\.json$/);
  });
});

describe('readTokenFile', () => {
  beforeEach(() => {
    mockBunFile.mockReset();
    mockBunWrite.mockReset().mockResolvedValue(undefined);
  });

  it('returns null when file does not exist', async () => {
    mockBunFile.mockReturnValue(makeMockFile({ exists: false }));

    const result = await readTokenFile();

    expect(result).toBeNull();
  });

  it('returns null for invalid JSON (throws during parse)', async () => {
    mockBunFile.mockReturnValue(
      makeMockFile({
        exists: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      }),
    );

    const result = await readTokenFile();

    expect(result).toBeNull();
  });

  it('returns null when JSON is missing required fields', async () => {
    mockBunFile.mockReturnValue(
      makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({ convexUrl: 'https://example.com' }),
      }),
    );

    const result = await readTokenFile();

    expect(result).toBeNull();
  });

  it('returns null when token field is not a string', async () => {
    mockBunFile.mockReturnValue(
      makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          convexUrl: 'https://example.com',
          token: 42,
          refreshToken: 'refresh',
        }),
      }),
    );

    const result = await readTokenFile();

    expect(result).toBeNull();
  });

  it('returns null when convexUrl is not HTTPS or localhost', async () => {
    mockBunFile.mockReturnValue(
      makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({
          convexUrl: 'http://evil.com',
          token: 'jwt',
          refreshToken: 'refresh',
        }),
      }),
    );

    const result = await readTokenFile();

    expect(result).toBeNull();
  });

  it('returns parsed data for a valid token file', async () => {
    mockBunFile.mockReturnValue(
      makeMockFile({
        exists: true,
        json: vi.fn().mockResolvedValue({ ...validTokenData }),
      }),
    );

    const result = await readTokenFile();

    expect(result).toEqual(validTokenData);
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

  it('writes the correct JSON to a temp file', async () => {
    await writeTokenFile(validTokenData);

    expect(writeFile).toHaveBeenCalledWith(
      `${getTokenFilePath()}.tmp`,
      JSON.stringify(validTokenData, null, 2),
      { mode: 0o600 },
    );
  });

  it('creates the token directory with recursive flag and 0700', async () => {
    await writeTokenFile(validTokenData);

    expect(mkdir).toHaveBeenCalledWith(expect.stringMatching(/\.holophyte$/), {
      recursive: true,
      mode: 0o700,
    });
  });

  it('atomically renames temp file to final path', async () => {
    await writeTokenFile(validTokenData);

    expect(rename).toHaveBeenCalledWith(
      `${getTokenFilePath()}.tmp`,
      getTokenFilePath(),
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

describe('createFetchToken', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.mocked(writeFile).mockReset().mockResolvedValue(undefined);
    vi.mocked(rename).mockReset().mockResolvedValue(undefined);
    vi.mocked(mkdir).mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns current token when forceRefreshToken is false', async () => {
    const fetchToken = createFetchToken(validTokenData);

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

    const fetchToken = createFetchToken(validTokenData);
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

    const fetchToken = createFetchToken(validTokenData);
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

    const fetchToken = createFetchToken(validTokenData);

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

  it('persists updated tokens to the token file after a successful refresh', async () => {
    const newTokens = { token: 'new-jwt', refreshToken: 'new-refresh' };
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ value: { tokens: newTokens } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const fetchToken = createFetchToken(validTokenData);
    await fetchToken({ forceRefreshToken: true });

    expect(writeFile).toHaveBeenCalledWith(
      `${getTokenFilePath()}.tmp`,
      JSON.stringify(
        {
          convexUrl: validTokenData.convexUrl,
          token: 'new-jwt',
          refreshToken: 'new-refresh',
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
  });

  it('returns null when refresh fails', async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));

    const fetchToken = createFetchToken(validTokenData);
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

    const fetchToken = createFetchToken(validTokenData);

    const token1 = await fetchToken({ forceRefreshToken: true });
    const token2 = await fetchToken({ forceRefreshToken: true });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(token1).toBe('first-jwt');
    expect(token2).toBe('second-jwt');
  });
});
