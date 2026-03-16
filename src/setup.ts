#!/usr/bin/env bun
// ── holophyte setup ──────────────────────────────────────────────────
//
// CLI command that authenticates the user via OAuth (GitHub/Google)
// through Convex Auth and stores the session token locally for the
// companion to use.

import { api } from '@convex/_generated/api';
import { ConvexHttpClient } from 'convex/browser';
import {
  getTokenFilePath,
  readTokenFile,
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

/** Reads CONVEX_URL and CONVEX_SITE_URL from env or .env.companion. */
async function loadConfig(): Promise<{
  convexUrl: string;
  convexSiteUrl: string;
}> {
  let convexUrl = process.env.CONVEX_URL;
  let convexSiteUrl = process.env.CONVEX_SITE_URL;

  // Fall back to .env.companion
  if (!convexUrl || !convexSiteUrl) {
    try {
      const envFile = await Bun.file('.env.companion').text();
      for (const line of envFile.split('\n')) {
        const [key, ...rest] = line.split('=');
        const value = rest.join('=').trim();
        if (key === 'CONVEX_URL' && !convexUrl) convexUrl = value;
        if (key === 'CONVEX_SITE_URL' && !convexSiteUrl) convexSiteUrl = value;
      }
    } catch {
      // .env.companion doesn't exist, that's OK
    }
  }

  // Derive CONVEX_SITE_URL from CONVEX_URL if missing
  if (convexUrl && !convexSiteUrl) {
    convexSiteUrl = convexUrl.replace('.convex.cloud', '.convex.site');
  }

  if (!convexUrl)
    die('CONVEX_URL is required. Set it in env or .env.companion');
  if (!convexSiteUrl)
    die('CONVEX_SITE_URL is required. Set it in env or .env.companion');

  return { convexUrl, convexSiteUrl };
}

/** Prompts the user to select an OAuth provider. */
async function selectProvider(): Promise<Provider> {
  const arg = process.argv[2]?.toLowerCase();
  if (arg && PROVIDERS.includes(arg as Provider)) {
    return arg as Provider;
  }

  console.log('\nSelect an authentication provider:');
  console.log('  1) GitHub');
  console.log('  2) Google');
  process.stdout.write('\nChoice [1]: ');

  for await (const line of console) {
    const choice = line.trim() || '1';
    if (choice === '1' || choice === 'github') return 'github';
    if (choice === '2' || choice === 'google') return 'google';
    process.stdout.write('Invalid choice. Enter 1 or 2: ');
  }

  return 'github'; // fallback
}

/** Opens a URL in the default browser. */
function openBrowser(url: string) {
  const cmd =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', url]
        : ['xdg-open', url];
  Bun.spawn(cmd, { stdout: 'ignore', stderr: 'ignore' });
}

async function main() {
  console.log('\n\x1b[1mHolophyte Setup\x1b[0m — Companion Authentication\n');

  // Check for existing token
  const existing = await readTokenFile();
  if (existing) {
    info(`Existing token found at ${getTokenFilePath()}`);
    process.stdout.write('Overwrite? [y/N]: ');
    for await (const line of console) {
      if (line.trim().toLowerCase() !== 'y') {
        console.log('Aborted.');
        process.exit(0);
      }
      break;
    }
  }

  const { convexUrl, convexSiteUrl } = await loadConfig();
  info(`Convex URL: ${convexUrl}`);
  info(`Convex Site: ${convexSiteUrl}`);

  const provider = await selectProvider();
  info(`Provider: ${provider}`);

  // Start ephemeral HTTP server to receive the OAuth callback
  const { promise: codePromise, resolve: resolveCode } =
    Promise.withResolvers<string>();

  const callbackServer = Bun.serve({
    port: 0, // ephemeral port
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === '/callback') {
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

    // Step 3: Wait for callback
    info('Waiting for authentication...');
    const verificationCode = await codePromise;

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
    await writeTokenFile({
      convexUrl,
      token: tokenResult.tokens.token,
      refreshToken: tokenResult.tokens.refreshToken,
    });

    success(`Token saved to ${getTokenFilePath()}`);
    console.log('\nThe companion will use this token on next startup.');
    console.log('Run `bun run companion` to start the companion.\n');
  } finally {
    callbackServer.stop();
  }
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
