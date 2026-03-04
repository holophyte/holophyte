import tailwindPlugin from 'bun-plugin-tailwind';

console.log('Building Holophyte SPA...');

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
const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  console.error('CONVEX_URL environment variable is required for production builds');
  process.exit(1);
}

const config = {
  convexUrl,
  e2eTest: false,
  allowAnonymousAuth: false,
  homeDir: '',
};

await Bun.write(
  './dist/config.js',
  `window.__HOLOPHYTE_CONFIG__=${JSON.stringify(config)};`,
);
console.log('Generated dist/config.js');

console.log(`Build complete. ${result.outputs.length + 1} output files written to dist/`);
