#!/usr/bin/env bun
// ── holophyte setup ──────────────────────────────────────────────────
//
// CLI command that authenticates the user via OAuth (GitHub/Google)
// through Convex Auth and stores the session token locally for the
// companion to use.

import { api } from '@convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import {
  getApiKeyFilePath,
  getTokensFilePath,
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

    // Offer optional MCP API key setup
    console.log('');
    process.stdout.write(
      'Set up an MCP API key? (generate one in Settings > API Keys) [y/N]: ',
    );
    const mcpAnswer = await readLine();
    if (mcpAnswer?.trim().toLowerCase() === 'y') {
      const siteUrl = await loadSiteUrl(convexUrl);
      await setupApiKey(siteUrl);
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
