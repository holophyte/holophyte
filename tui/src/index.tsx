#!/usr/bin/env bun

/**
 * holo CLI entry point — thin dispatcher.
 *
 * 'daemon' and 'tui' branches use dynamic import to keep the static import
 * graph lean (no OpenTUI overhead on `holo new/ls/next/setup`).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { harnessInfos } from './adapters';
import type { CliDeps } from './cli';
import { makeEnsureDaemon, parseArgs, runCli } from './cli';
import { request } from './client';
import { holoHome } from './paths';
import { attachOrSwitch, isInsideTmux, RealTmux } from './tmux';

const thisFilePath = fileURLToPath(import.meta.url);
const tuiArgv = [process.execPath, thisFilePath, 'tui'];
const daemonArgv = [process.execPath, thisFilePath, 'daemon'];

const cmd = parseArgs(process.argv.slice(2));

if (cmd.kind === 'daemon') {
  // Foreground daemon — runs on import. Keep the dynamic import so the
  // static import graph doesn't pull in all the daemon dependencies for
  // `holo ls`.
  await import('./daemon/main');
  // daemon/main.ts never returns (it sets up signal handlers)
} else if (cmd.kind === 'tui') {
  // OpenTUI renderer — dynamic import keeps it out of the fast-path bundle.
  const [{ createCliRenderer }, { createRoot }, React, { App }] =
    await Promise.all([
      import('@opentui/core'),
      import('@opentui/react'),
      import('react'),
      import('./ui/App'),
    ]);

  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    exitOnCtrlC: false,
    clearOnShutdown: true,
  });

  const root = createRoot(renderer);
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    root.unmount();
    renderer.destroy();
  };

  process.on('SIGINT', () => {
    shutdown();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    shutdown();
    process.exit(143);
  });

  root.render(
    React.createElement(App, {
      onQuit: () => {
        shutdown();
        process.exit(0);
      },
    }),
  );
  renderer.start();

  // Block until the renderer is destroyed (onQuit path or signal).
  await new Promise<void>((resolve) => {
    renderer.once('destroy', () => resolve());
  });
} else {
  // All other commands (attach, new, next, ls, setup, help, unknown).
  function spawnDetached(argv: string[], logPath: string): void {
    mkdirSync(holoHome(), { recursive: true });
    const fd = openSync(logPath, 'a');
    const [execPath, ...args] = argv;
    if (!execPath) return;
    const child = spawn(execPath, args, {
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    child.unref();
  }

  const tmux = new RealTmux();

  const deps: CliDeps = {
    request,
    ensureDaemon: makeEnsureDaemon({ spawnDetached, request, daemonArgv }),
    tmux,
    tuiArgv,
    isInsideTmux,
    attachOrSwitch: () => attachOrSwitch(),
    selectTuiWindow: async () => {
      // Switch focus to the TUI window within the holo session
      const { tmuxSessionName } = await import('./paths');
      await tmux.selectWindow(`${tmuxSessionName()}:tui`);
    },
    harnessInfos,
    now: () => Date.now(),
    stdout: (line) => process.stdout.write(line + '\n'),
    stderr: (line) => process.stderr.write(line + '\n'),
  };

  process.exit(await runCli(cmd, deps));
}
