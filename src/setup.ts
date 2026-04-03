#!/usr/bin/env bun

// ── holophyte setup ──────────────────────────────────────────────────
//
// CLI command that authenticates the user via OAuth (GitHub/Google)
// through Convex Auth and stores the session token locally for the
// companion to use.

import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { ConvexHttpClient } from 'convex/browser';
import {
  getApiKeyFilePath,
  getTokensFilePath,
  readApiKeyFile,
  readTokenFile,
  writeApiKeyFile,
  writeTokenFile,
} from './server/auth-token';

const PROVIDERS = ['github', 'google'] as const;
type Provider = (typeof PROVIDERS)[number];

function die(msg: string): never {
  console.error(`\x1b[31mError:\x1b[0m ${msg}`);
  process.exit(1);
}

function info(msg: string) {
  console.log(`\x1b[36mℹ\x1b[0m ${msg}`);
}

function success(msg: string) {
  console.log(`\x1b[32m✔\x1b[0m ${msg}`);
}

/**
 * Reads a single line from stdin without closing the stream.
 * Using `for await (const line of console)` closes the iterator on `break`,
 * making subsequent reads return EOF. This uses the raw stream reader instead.
 */
let _stdinReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
const decoder = new TextDecoder();
let stdinBuffer = '';

function getStdinReader() {
  if (!_stdinReader) _stdinReader = Bun.stdin.stream().getReader();
  return _stdinReader;
}

async function readLine(): Promise<string | null> {
  while (true) {
    const newlineIdx = stdinBuffer.indexOf('\n');
    if (newlineIdx !== -1) {
      const line = stdinBuffer.slice(0, newlineIdx).replace(/\r$/, '');
      stdinBuffer = stdinBuffer.slice(newlineIdx + 1);
      return line;
    }
    const { done, value } = await getStdinReader().read();
    if (done) {
      stdinBuffer += decoder.decode(); // flush pending bytes
      if (stdinBuffer.length > 0) {
        const remaining = stdinBuffer;
        stdinBuffer = '';
        return remaining;
      }
      return null;
    }
    stdinBuffer += decoder.decode(value, { stream: true });
  }
}

/**
 * Parses .env.companion and returns a map of key-value pairs.
 * Returns an empty map if the file doesn't exist.
 */
async function readEnvCompanion(): Promise<Map<string, string>> {
  const vars = new Map<string, string>();
  try {
    const envFile = await Bun.file('.env.companion').text();
    for (const line of envFile.split('\n')) {
      const [key, ...rest] = line.split('=');
      const value = rest
        .join('=')
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      const trimmedKey = key?.trim();
      if (trimmedKey && value) vars.set(trimmedKey, value);
    }
  } catch {
    // .env.companion doesn't exist, that's OK
  }
  return vars;
}

/** Reads CONVEX_URL and CONVEX_DEPLOYMENT from env or .env.companion. */
async function loadConfig(): Promise<{
  convexUrl: string;
  deployment: string;
}> {
  let convexUrl = process.env.CONVEX_URL;
  let deployment = process.env.CONVEX_DEPLOYMENT;

  if (!convexUrl || !deployment) {
    const vars = await readEnvCompanion();
    if (!convexUrl) convexUrl = vars.get('CONVEX_URL');
    if (!deployment) deployment = vars.get('CONVEX_DEPLOYMENT');
  }

  if (!convexUrl)
    die('CONVEX_URL is required. Set it in env or .env.companion');
  if (!deployment)
    die(
      'CONVEX_DEPLOYMENT is required. Run `convex dev` first or set it in env.',
    );

  return { convexUrl: convexUrl.replace(/\/$/, ''), deployment };
}

/** Prompts the user to select an authentication provider. */
async function selectProvider(): Promise<Provider> {
  const arg = process.argv[2]?.toLowerCase();
  if (arg === 'github' || arg === 'google') {
    return arg as Provider;
  }

  console.log('\nSelect an authentication provider:');
  console.log('  1) GitHub');
  console.log('  2) Google');
  process.stdout.write('\nChoice [1]: ');

  while (true) {
    const line = await readLine();
    if (line === null) {
      console.log('Aborted (no input).');
      process.exit(0);
    }
    const choice = line.trim() || '1';
    if (choice === '1' || choice === 'github') return 'github';
    if (choice === '2' || choice === 'google') return 'google';
    process.stdout.write('Invalid choice. Enter 1 or 2: ');
  }
}

/**
 * Derives the Convex HTTP site URL from env or .env.companion.
 * Uses CONVEX_SITE_URL if set; for cloud, derives from CONVEX_URL
 * by replacing .convex.cloud with .convex.site.
 */
async function loadSiteUrl(convexUrl: string): Promise<string> {
  const siteUrl =
    process.env.CONVEX_SITE_URL ??
    (await readEnvCompanion()).get('CONVEX_SITE_URL');

  if (siteUrl) return siteUrl.replace(/\/$/, '');

  return convexUrl
    .replace(/\.convex\.cloud$/, '.convex.site')
    .replace(/\/$/, '');
}

const EXPIRY_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
  { label: 'No expiration', days: 0 },
] as const;

const MS_PER_DAY = 86_400_000;

/** Prompts for an expiration duration. Returns a timestamp or undefined. */
async function promptExpiration(): Promise<number | undefined> {
  console.log('\nAdd an expiration?');
  for (const [i, opt] of EXPIRY_OPTIONS.entries()) {
    const isDefault = opt.days === 90;
    console.log(`  ${i + 1}) ${opt.label}${isDefault ? ' (default)' : ''}`);
  }
  process.stdout.write('\nChoice [3]: ');

  while (true) {
    const line = await readLine();
    const choice = (line ?? '').trim() || '3';
    const idx = Number(choice) - 1;
    const opt = EXPIRY_OPTIONS[idx];
    if (opt) {
      return opt.days > 0 ? Date.now() + opt.days * MS_PER_DAY : undefined;
    }
    process.stdout.write(`Invalid choice. Enter 1-${EXPIRY_OPTIONS.length}: `);
  }
}

/** Generates an MCP API key via Convex and writes it to disk. */
async function generateApiKey(
  httpClient: ConvexHttpClient,
  expiresAt?: number,
): Promise<boolean> {
  let rawKey: string;
  try {
    rawKey = await httpClient.action(api.apiKeys.generate, {
      name: 'MCP (auto-generated by CLI)',
      scopes: ['mcp'],
      ...(expiresAt !== undefined && { expiresAt }),
    });
  } catch (err) {
    console.error(`\x1b[33m⚠\x1b[0m  Failed to generate API key: ${err}`);
    return false;
  }

  try {
    await writeApiKeyFile(rawKey);
  } catch (err) {
    console.error(
      `\x1b[31mError:\x1b[0m Failed to write API key to ${getApiKeyFilePath()}: ${err}`,
    );
    console.error(
      `\x1b[33m⚠\x1b[0m  Your key was generated but could not be saved. Copy it now:\n\n  ${rawKey}\n`,
    );
    return false;
  }

  success(`API key saved to ${getApiKeyFilePath()}`);
  return true;
}

/** Prompts for an MCP API key, validates it against the server, and writes it to disk. */
async function setupApiKey(siteUrl: string): Promise<void> {
  const API_KEY_REGEX = /^holo_[0-9a-f]{64}$/;

  process.stdout.write('\nPaste your API key: ');
  const input = await readLine();
  if (!input) {
    die('Aborted (no input).');
  }
  const key = input.trim();

  if (!API_KEY_REGEX.test(key)) {
    die(
      'Invalid API key format. Keys must start with holo_ and be 69 characters total (holo_ + 64 hex chars).',
    );
  }

  info('Validating API key...');
  let resp: Response;
  try {
    resp = await fetch(`${siteUrl}/api/keys/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key, scope: 'mcp' }),
    });
  } catch (err) {
    die(`Could not reach Convex endpoint: ${err}`);
  }

  if (!resp.ok) {
    const body = (await resp.json().catch(() => ({}))) as { error?: string };
    die(`API key validation failed: ${body.error ?? resp.statusText}`);
  }

  await writeApiKeyFile(key);
  success(`API key saved to ${getApiKeyFilePath()}`);
}

/** Opens a URL in the default browser. */
function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '""', url]
        : ['xdg-open', url];
  Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
}

async function main() {
  console.log('\n\x1b[1mHolophyte Setup\x1b[0m — Companion Authentication\n');

  // Load config first so we know which deployment to check/write
  const { convexUrl, deployment } = await loadConfig();
  info(`Convex URL: ${convexUrl}`);
  info(`Deployment: ${deployment}`);

  // Check for existing token for this deployment
  const existing = await readTokenFile(deployment);
  if (existing.status === 'ok') {
    info(`Existing token found for deployment ${deployment}`);
    process.stdout.write('Overwrite? [y/N]: ');
    const answer = await readLine();
    if (answer === null || answer.trim().toLowerCase() !== 'y') {
      console.log('Aborted.');
      process.exit(0);
    }
  } else if (existing.status === 'invalid') {
    info(
      `Existing token for ${deployment} is invalid (${existing.reason}) — will replace`,
    );
  }

  const provider = await selectProvider();
  info(`Provider: ${provider}`);

  // Start ephemeral HTTP server to receive the OAuth callback
  const {
    promise: codePromise,
    resolve: resolveCode,
    reject: rejectCode,
  } = Promise.withResolvers<string>();

  const callbackServer = Bun.serve({
    port: 0, // ephemeral port
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === '/callback') {
        // Handle OAuth error (user denied access)
        const error = url.searchParams.get('error');
        if (error) {
          const desc = url.searchParams.get('error_description') ?? error;
          rejectCode(new Error(`OAuth denied: ${desc}`));
          const safeDesc = desc
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          return new Response(
            `<html><body><h2>Authentication failed</h2><p>${safeDesc}</p><p>You can close this tab.</p></body></html>`,
            { headers: { 'Content-Type': 'text/html' } },
          );
        }
        const code = url.searchParams.get('code');
        if (code) {
          resolveCode(code);
          return new Response(
            '<html><body><h2>Authentication successful!</h2><p>You can close this tab and return to the terminal.</p></body></html>',
            { headers: { 'Content-Type': 'text/html' } },
          );
        }
        return new Response('Missing code parameter', { status: 400 });
      }
      return new Response('Not found', { status: 404 });
    },
  });

  const callbackUrl = `http://localhost:${callbackServer.port}/callback`;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    // Step 1: Initiate OAuth flow
    info('Starting OAuth flow...');
    const httpClient = new ConvexHttpClient(convexUrl);

    const initResult = await httpClient.action(api.auth.signIn, {
      provider,
      params: { redirectTo: callbackUrl },
    });

    if (!initResult.redirect) {
      die('OAuth flow did not return a redirect URL');
    }

    const redirectUrl = initResult.redirect;
    const verifier = initResult.verifier;

    // Step 2: Open browser
    info('Opening browser for authentication...');
    openBrowser(redirectUrl);
    console.log(`\nIf the browser didn't open, visit:\n  ${redirectUrl}\n`);

    // Step 3: Wait for callback (5 minute timeout)
    info('Waiting for authentication...');
    const TIMEOUT_MS = 5 * 60 * 1000;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error('OAuth callback timed out after 5 minutes')),
        TIMEOUT_MS,
      );
    });
    const verificationCode = await Promise.race([codePromise, timeout]);

    // Step 4: Exchange code for tokens
    info('Exchanging code for tokens...');
    const tokenResult = await httpClient.action(api.auth.signIn, {
      params: { code: verificationCode },
      verifier,
    });

    if (!tokenResult.tokens) {
      die('Token exchange failed — no tokens returned');
    }

    // Step 5: Store tokens
    await writeTokenFile(deployment, {
      convexUrl,
      token: tokenResult.tokens.token,
      refreshToken: tokenResult.tokens.refreshToken,
    });

    success(`Token saved to ${getTokensFilePath()} [${deployment}]`);
    console.log('\nThe companion will use this token on next startup.');

    // ── MCP API key setup ───────────────────────────────────────────
    console.log('');
    httpClient.setAuth(tokenResult.tokens.token);

    // Validate existing local key against the server
    const localKey = await readApiKeyFile();
    // null = unknown (no key or network error), true = active, false = invalid/expired/revoked
    let keyStatus: boolean | null = null;

    if (localKey) {
      const siteUrl = await loadSiteUrl(convexUrl);
      try {
        const resp = await fetch(`${siteUrl}/api/keys/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: localKey, scope: 'mcp' }),
        });
        keyStatus = resp.ok;
      } catch {
        // Network error — leave as null (unknown)
      }
    }

    let shouldGenerate: boolean;

    if (keyStatus === true) {
      info('You already have an active MCP API key.');
      process.stdout.write(
        'Generate a new API key for the Holophyte MCP? [y/N]: ',
      );
      const answer = await readLine();
      shouldGenerate = answer?.trim().toLowerCase() === 'y';
    } else if (keyStatus === false) {
      console.log(
        '\x1b[33m⚠\x1b[0m  Your local MCP API key is no longer valid (expired or revoked).',
      );
      process.stdout.write(
        'Generate a new API key for the Holophyte MCP? [Y/n]: ',
      );
      const answer = await readLine();
      shouldGenerate = answer?.trim().toLowerCase() !== 'n';
    } else {
      // No key on disk, or couldn't validate (network error)
      if (localKey) {
        info('Could not validate your existing MCP API key (network error).');
      }
      process.stdout.write(
        'Generate a new API key for the Holophyte MCP? [Y/n]: ',
      );
      const answer = await readLine();
      shouldGenerate = answer?.trim().toLowerCase() !== 'n';
    }

    if (shouldGenerate) {
      // Collect old CLI-generated key IDs before generating a new one
      // so we don't accidentally revoke the newly created key.
      let oldKeyIds: Id<'apiKeys'>[] = [];
      try {
        const keys = await httpClient.query(api.apiKeys.list, {});
        oldKeyIds = keys
          .filter(
            (k) =>
              k.name === 'MCP (auto-generated by CLI)' &&
              k.revokedAt === undefined,
          )
          .map((k) => k._id);
      } catch {
        // Best-effort — proceed without revocation info
      }

      const expiresAt = await promptExpiration();
      info('Generating MCP API key...');
      const ok = await generateApiKey(httpClient, expiresAt);
      if (ok) {
        // Revoke old CLI-generated keys now that the new one is saved
        for (const keyId of oldKeyIds) {
          try {
            await httpClient.mutation(api.apiKeys.revoke, { keyId });
          } catch {
            // Best-effort — old keys stay active but aren't a blocker
          }
        }
      } else {
        info('Auto-generation failed. You can paste a key manually.');
        const siteUrl = await loadSiteUrl(convexUrl);
        await setupApiKey(siteUrl);
      }
    }

    console.log('\nRun `bun run companion` to start the companion.\n');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    await callbackServer.stop();
    if (_stdinReader) await _stdinReader.cancel();
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
