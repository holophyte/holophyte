import tailwindPlugin from 'bun-plugin-tailwind';

const convexUrl = process.env.CONVEX_URL;
if (!convexUrl) {
  console.error('Error: CONVEX_URL environment variable is required for the static build.');
  process.exit(1);
}

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
  define: {
    'process.env.CONVEX_URL': JSON.stringify(convexUrl),
    'process.env.E2E_TEST': JSON.stringify(''),
    'process.env.ALLOW_ANONYMOUS_AUTH': JSON.stringify(''),
    'process.env.HOME': JSON.stringify(''),
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
});

if (!result.success) {
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

console.log(`Build complete. ${result.outputs.length} output files written to dist/`);
