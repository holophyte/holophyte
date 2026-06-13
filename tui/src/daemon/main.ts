/**
 * holod foreground entry — the CLI spawns this detached:
 *   <bun> /abs/path/to/src/daemon/main.ts
 */

import { fileURLToPath } from 'node:url';
import { adapters, harnessInfos } from '../adapters';
import { socketPath } from '../paths';
import { RealTmux } from '../tmux';
import { Daemon } from './server';

async function main(): Promise<void> {
  const entry = fileURLToPath(new URL('../index.tsx', import.meta.url));
  const daemon = new Daemon({
    tmux: new RealTmux(),
    adapters,
    harnesses: await harnessInfos(),
    // 'tui' subcommand renders the TUI in window 0 (stage-3 contract)
    tuiArgv: [process.execPath, entry, 'tui'],
    // each agent window gets a live 'holo sidebar' pane; HOLO_SIDEBAR=0 opts out
    ...(process.env.HOLO_SIDEBAR === '0'
      ? {}
      : { sidebarArgv: [process.execPath, entry, 'sidebar'] }),
  });
  await daemon.start();
  console.log(`holod listening on ${socketPath()}`);

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`holod: ${signal} received, shutting down`);
      void daemon.stop().finally(() => process.exit(0));
    });
  }
}

main().catch((err) => {
  console.error('holod failed to start:', err);
  process.exit(1);
});
