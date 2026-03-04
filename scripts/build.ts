import tailwindPlugin from 'bun-plugin-tailwind';

console.log('Building Holophyte SPA...');

// Fail fast if CONVEX_URL is missing
const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
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
  e2eTest: false,
  allowAnonymousAuth: false,
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
// VERCEL_ENV is set automatically by Vercel: 'production', 'preview', or 'development'.
if (process.env.VERCEL_ENV === 'production') {
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
