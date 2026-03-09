import tailwindPlugin from 'bun-plugin-tailwind';

console.log('Building Holophyte SPA...');

const vercelEnv = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
const isProduction = vercelEnv === 'production';
const isPreview = vercelEnv === 'preview';

// For preview builds, deploy Convex first to get the preview backend URL.
// For production, CONVEX_URL is set as a Vercel env var.
let convexUrl = process.env.CONVEX_URL;

if (isPreview) {
  convexUrl = await deployConvexPreview();
} else if (!convexUrl) {
  console.error(
    'CONVEX_URL environment variable is required for production builds',
  );
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

// Deploy Convex functions in production so frontend and backend stay in sync.
if (isProduction) {
  if (!process.env.CONVEX_DEPLOY_KEY) {
    console.error(
      'CONVEX_DEPLOY_KEY environment variable is required for production Convex deploy',
    );
    process.exit(1);
  }
  console.log('Production environment detected — deploying Convex functions...');
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

// ── Preview deployment helper ─────────────────────────────────────────

async function deployConvexPreview(): Promise<string> {
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

  // Sanitize branch name for use as preview identifier (e.g. feat/foo → feat-foo)
  const previewName = branch.replace(/[^a-zA-Z0-9-]/g, '-');
  console.log(`Preview environment detected — deploying Convex preview "${previewName}"...`);

  const deploy = Bun.spawnSync(
    ['bunx', 'convex', 'deploy', '--preview-create', previewName],
    { stdout: 'pipe', stderr: 'inherit' },
  );

  if (deploy.exitCode !== 0) {
    console.error('Convex preview deploy failed');
    process.exit(1);
  }

  const output = deploy.stdout.toString();
  console.log(output);

  // Parse the preview URL from output: "Deployed Convex functions to https://..."
  const match = output.match(/https:\/\/[^\s]+\.convex\.cloud/);
  if (!match) {
    console.error(
      'Could not parse preview Convex URL from deploy output:\n',
      output,
    );
    process.exit(1);
  }

  const url = match[0];
  console.log(`Preview Convex URL: ${url}`);
  return url;
}
