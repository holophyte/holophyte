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

console.log(`Build complete. ${result.outputs.length} output files written to dist/`);
