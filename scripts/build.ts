import { createHash, randomBytes } from 'node:crypto';
import tailwindPlugin from 'bun-plugin-tailwind';

const vercelEnv = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
const isProduction = vercelEnv === 'production';
const isPreview = vercelEnv === 'preview';

// ── Preview: delegate to Convex CLI ───────────────────────────────────
// For preview builds, `convex deploy --cmd` re-invokes this script with
// CONVEX_IS_PREVIEW_CMD=1 set. On the first invocation we launch the
// Convex deploy wrapper. On the nested invocation we skip this block
// and fall through to the normal build (with CONVEX_URL set by Convex).
if (isPreview && !process.env.CONVEX_IS_PREVIEW_CMD) {
  const branch = process.env.VERCEL_GIT_COMMIT_REF;
  if (!branch) {
    console.error(
      'VERCEL_GIT_COMMIT_REF is required for preview Convex deployments',
    );
    process.exit(1);
  }
  if (!process.env.CONVEX_DEPLOY_KEY) {
    console.error(
      'CONVEX_DEPLOY_KEY is required for preview Convex deployments',
    );
    process.exit(1);
  }

  // Sanitize branch name for preview identifier (e.g. feat/foo → feat-foo-a1b2c3d).
  // Append a short hash to avoid collisions (feat/auth-flow vs feat-auth-flow).
  const suffix = createHash('sha1').update(branch).digest('hex').slice(0, 7);
  const previewName = `${branch.replace(/[^a-zA-Z0-9-]/g, '-').replace(/-{2,}/g, '-').slice(0, 50)}-${suffix}`;
  console.log(
    `Preview environment — deploying Convex preview "${previewName}"...`,
  );

  const deploy = Bun.spawnSync(
    [
      'bunx',
      'convex',
      'deploy',
      '--preview-create',
      previewName,
      '--cmd',
      'CONVEX_IS_PREVIEW_CMD=1 bun run build',
      '--cmd-url-env-var-name',
      'CONVEX_URL',
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );

  if (deploy.exitCode !== 0) {
    console.error('Convex preview deploy failed');
    process.exit(1);
  }

  // Seed auth keys and env vars on the fresh preview backend.
  // Each preview deploy creates a new backend, so these must be set every time.
  console.log('Setting up auth keys on preview backend...');

  // VERCEL_URL is the deployment URL without protocol (e.g. "my-app-abc123.vercel.app")
  const siteUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : undefined;

  const authSetup = Bun.spawnSync(
    [
      'bunx',
      '@convex-dev/auth',
      '--preview-name',
      previewName,
      ...(siteUrl ? ['--web-server-url', siteUrl] : []),
      '--skip-git-check',
      '--allow-dirty-git-state',
    ],
    { stdout: 'inherit', stderr: 'inherit' },
  );
  if (authSetup.exitCode !== 0) {
    console.error('Warning: failed to set up auth keys on preview backend');
    // Non-fatal — the build itself succeeded
  }

  // Read the Convex URL written by the nested build (see below).
  const convexUrlFile = '.convex-preview-url';
  const previewConvexUrl = await Bun.file(convexUrlFile)
    .text()
    .catch(() => '');

  // Set env vars needed for the preview backend to function.
  // CONVEX_SELF_URL lets the companion script discover the preview backend URL.
  const previewEnvVars: Record<string, string> = {
    ALLOW_ANONYMOUS_AUTH: '1',
    INTERNAL_API_SECRET: randomBytes(32).toString('hex'),
    ...(previewConvexUrl && { CONVEX_SELF_URL: previewConvexUrl.trim() }),
  };
  for (const [key, value] of Object.entries(previewEnvVars)) {
    const envSet = Bun.spawnSync(
      ['bunx', 'convex', 'env', 'set', key, value, '--preview-name', previewName],
      { stdout: 'inherit', stderr: 'inherit' },
    );
    if (envSet.exitCode !== 0) {
      console.error(`Warning: failed to set ${key} on preview backend`);
    }
  }

  // The nested `bun run build` already wrote dist/ — we're done.
  process.exit(0);
}

// ── Frontend build ────────────────────────────────────────────────────

console.log('Building Holophyte SPA...');

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  console.error('CONVEX_URL environment variable is required for builds');
  process.exit(1);
}

// Clean stale output from previous builds
const { rmSync } = await import('node:fs');
rmSync('./dist', { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: ['./public/index.html'],
  outdir: './dist',
  minify: true,
  sourcemap: 'linked',
  plugins: [tailwindPlugin],
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Generate config.js with build-time environment variables
const config = {
  convexUrl,
  e2eTest: false, // Dev-only feature — never enabled in static/Vercel builds.
  allowAnonymousAuth: isPreview, // Enabled on preview builds for testing via ?auth param.
};

await Bun.write(
  './dist/config.js',
  `window.__HOLOPHYTE_CONFIG__=${JSON.stringify(config)};`,
);
console.log('Generated dist/config.js');

console.log(
  `Build complete. ${result.outputs.length + 1} output files written to dist/`,
);

// When running inside `convex deploy --cmd`, write the Convex URL to a temp file
// so the outer build scope can store it as an env var on the preview backend.
if (process.env.CONVEX_IS_PREVIEW_CMD) {
  await Bun.write('.convex-preview-url', convexUrl);
}

// ── Production: deploy Convex after build ─────────────────────────────
if (isProduction) {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    console.error(
      'CONVEX_DEPLOY_KEY environment variable is required for production Convex deploy',
    );
    process.exit(1);
  }
  console.log(
    'Production environment detected — deploying Convex functions...',
  );
  const deploy = Bun.spawnSync(['bunx', 'convex', 'deploy'], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (deploy.exitCode !== 0) {
    console.error('Convex deploy failed');
    process.exit(1);
  }
  console.log('Convex functions deployed.');
}
