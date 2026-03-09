import { createHash } from 'node:crypto';
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
  const previewName = `${branch.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 50)}-${suffix}`;
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
  allowAnonymousAuth: false, // Dev-only feature — never enabled in static/Vercel builds.
  homeDir: '', // Legacy — not meaningful on Vercel. See #130.
};

await Bun.write(
  './dist/config.js',
  `window.__HOLOPHYTE_CONFIG__=${JSON.stringify(config)};`,
);
console.log('Generated dist/config.js');

console.log(
  `Build complete. ${result.outputs.length + 1} output files written to dist/`,
);

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
