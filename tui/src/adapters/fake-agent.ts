/**
 * FakeAgent — standalone script standing in for a real agent harness.
 * Spawned by FakeAdapter as:
 *   <bun> fake-agent.ts <sessionId> --home <holoHome> [--script <json>]
 *
 * Emits scripted hook events to the daemon socket so the fast suite and TUI
 * tests run with no real agent binaries and no API usage (spec.md Testing).
 *
 * Script steps: { delayMs, event? , permission? } — delayMs is the wait
 * BEFORE performing that step (sequential). Permission steps print the
 * daemon's decision to stdout so tests/humans can observe it.
 */

import { request, tryRequest } from '../client';
import type { SessionEvent } from '../protocol';

interface Step {
  delayMs: number;
  event?: SessionEvent;
  permission?: { tool: string; input?: unknown; timeoutMs?: number };
}

// Timeline: ready @0ms, prompt @500ms, tool @1000ms, stop @2500ms.
const DEFAULT_SCRIPT: Step[] = [
  { delayMs: 0, event: { kind: 'ready' } },
  { delayMs: 500, event: { kind: 'prompt' } },
  { delayMs: 500, event: { kind: 'tool' } },
  {
    delayMs: 1500,
    event: { kind: 'stop', lastMessage: 'fake agent: work complete' },
  },
];

const DEFAULT_PERMISSION_HOLD_MS = 90000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): {
  sessionId: string;
  home?: string;
  script?: string;
} {
  const sessionId = argv[0] ?? '';
  let home: string | undefined;
  let script: string | undefined;
  for (let i = 1; i < argv.length - 1; i++) {
    if (argv[i] === '--home') home = argv[++i];
    else if (argv[i] === '--script') script = argv[++i];
  }
  return { sessionId, home, script };
}

function parseScript(json: string | undefined): Step[] | undefined {
  if (!json) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return undefined;
    return parsed
      .filter(
        (step): step is Record<string, unknown> =>
          step !== null && typeof step === 'object',
      )
      .map((step) => ({
        ...(step as object),
        delayMs: typeof step.delayMs === 'number' ? step.delayMs : 0,
      })) as Step[];
  } catch {
    return undefined;
  }
}

async function run(): Promise<void> {
  const { sessionId, home, script } = parseArgs(process.argv.slice(2));
  // Must be set before any client call — paths.ts reads HOLO_HOME lazily.
  if (home) process.env.HOLO_HOME = home;

  process.on('SIGTERM', () => process.exit(0));
  process.on('SIGINT', () => process.exit(0));

  const steps = parseScript(script) ?? DEFAULT_SCRIPT;
  for (const step of steps) {
    if (step.delayMs > 0) await sleep(step.delayMs);
    if (step.event) {
      await tryRequest(
        { cmd: 'hook', sessionId, event: step.event, ts: Date.now() },
        { timeoutMs: 1000 },
      );
    }
    if (step.permission) {
      const timeoutMs = step.permission.timeoutMs ?? DEFAULT_PERMISSION_HOLD_MS;
      let decision = 'error';
      try {
        const response = await request(
          {
            cmd: 'permission',
            sessionId,
            tool: step.permission.tool,
            input: step.permission.input ?? null,
            timeoutMs,
            ts: Date.now(),
          },
          { timeoutMs: timeoutMs + 5000 },
        );
        if (response.ok && 'decision' in response) decision = response.decision;
      } catch {
        // daemon down — observed as 'error'
      }
      process.stdout.write(`${decision}\n`);
    }
  }

  // Keep the process (and its tmux window) alive until killed.
  await new Promise(() => {});
}

run().catch((err) => {
  process.stderr.write(`fake-agent: ${String(err)}\n`);
  process.exit(1);
});
