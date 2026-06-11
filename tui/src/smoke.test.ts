/**
 * Real-harness smoke layer (spec.md Testing section): spawn interactive
 * claude/codex in an ISOLATED tmux server (tmux -L), drive them with
 * send-keys, and assert daemon state transitions from real hook events —
 * readiness comes from the SessionStart hook ('starting…' → 'awaiting first
 * prompt'), never from sleeping.
 *
 * Gated — uses real agent binaries and real API/subscription quota:
 *   HOLO_SMOKE=claude  bun node_modules/vitest/vitest.mjs run src/smoke.test.ts
 *   HOLO_SMOKE=codex / HOLO_SMOKE=all
 *
 * The isolated -L server means Ko's real tmux server, sessions, and key
 * bindings are never touched; the server is killed in teardown.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adapters, harnessInfos } from './adapters';
import { subscribe } from './client';
import { Daemon } from './daemon/server';
import type { StatePush } from './protocol';
import { defaultRunner, RealTmux, type TmuxRunner } from './tmux';
import type { Session } from './types';

const SMOKE = process.env.HOLO_SMOKE ?? '';
const RUN_CLAUDE = SMOKE === 'claude' || SMOKE === 'all' || SMOKE === '1';
const RUN_CODEX = SMOKE === 'codex' || SMOKE === 'all';
const ANY = RUN_CLAUDE || RUN_CODEX;

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url)); // pre-trusted cwd
const TMUX_SOCKET = `holo-smoke-${process.pid}`;

/** every tmux call goes to the isolated -L server */
const runner: TmuxRunner = (args) =>
  defaultRunner(['-L', TMUX_SOCKET, ...args]);

const PROMPT = 'Reply with exactly: ok. Do not use any tools.';

describe.skipIf(!ANY)('real-harness smoke (HOLO_SMOKE gated)', () => {
  let savedHome: string | undefined;
  let savedSession: string | undefined;
  let home = '';
  let daemon: Daemon;
  let sub: { close(): void };
  const pushes: StatePush[] = [];

  const find = (id: string): Session | undefined =>
    pushes[pushes.length - 1]?.sessions.find((s) => s.id === id);

  async function waitFor(
    label: string,
    predicate: () => boolean,
    timeoutMs: number,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`smoke: timed out waiting for ${label}`);
  }

  async function lifecycle(harness: 'claude' | 'codex'): Promise<void> {
    const res = await import('./client').then((c) =>
      c.request({ cmd: 'new', harness, cwd: REPO_ROOT }, { timeoutMs: 15000 }),
    );
    if (!res.ok || !('session' in res)) {
      throw new Error(`spawn failed: ${JSON.stringify(res)}`);
    }
    const id = res.session.id;
    const windowId = res.session.tmuxWindow;

    // Readiness = SessionStart hook fired through the real injection path.
    await waitFor(
      `${id} ready (SessionStart hook)`,
      () => find(id)?.attentionReason === 'awaiting first prompt',
      60_000,
    );

    // Grace for the harness TUI to mount its input box, then type the prompt.
    await new Promise((r) => setTimeout(r, 2_500));
    await runner(['send-keys', '-t', windowId, PROMPT]);
    await new Promise((r) => setTimeout(r, 300));
    await runner(['send-keys', '-t', windowId, 'Enter']);

    await waitFor(
      `${id} running (UserPromptSubmit hook)`,
      () => find(id)?.status === 'running',
      30_000,
    );
    await waitFor(
      `${id} idle after turn (Stop hook)`,
      () =>
        find(id)?.status === 'idle' &&
        find(id)?.attentionReason === 'review / next prompt',
      120_000,
    );
    expect(find(id)?.lastMessage ?? '').toMatch(/ok/i);
  }

  beforeAll(async () => {
    savedHome = process.env.HOLO_HOME;
    savedSession = process.env.HOLO_TMUX_SESSION;
    home = mkdtempSync(join(tmpdir(), 'holo-sm-'));
    process.env.HOLO_HOME = home;
    process.env.HOLO_TMUX_SESSION = 'holo';
    daemon = new Daemon({
      tmux: new RealTmux(runner),
      adapters,
      harnesses: await harnessInfos(),
      tuiArgv: ['sleep', '600'],
      sweepIntervalMs: 600_000,
    });
    await daemon.start();
    sub = subscribe({ onState: (push) => pushes.push(push) });
  });

  afterAll(async () => {
    sub?.close();
    await runner(['kill-server']).catch(() => {});
    await daemon?.stop();
    if (savedHome === undefined) delete process.env.HOLO_HOME;
    else process.env.HOLO_HOME = savedHome;
    if (savedSession === undefined) delete process.env.HOLO_TMUX_SESSION;
    else process.env.HOLO_TMUX_SESSION = savedSession;
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it.skipIf(!RUN_CLAUDE)(
    'claude: spawn → ready → running → idle',
    async () => {
      await lifecycle('claude');
    },
    240_000,
  );

  it.skipIf(!RUN_CODEX)(
    'codex: spawn → ready → running → idle',
    async () => {
      await lifecycle('codex');
    },
    240_000,
  );
});
