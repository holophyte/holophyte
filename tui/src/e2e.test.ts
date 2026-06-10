/**
 * FakeAgent end-to-end test — real daemon over a real Unix socket, FakeTmux,
 * FakeAdapter, fake-agent.ts spawned as a child process (as FakeTmux records
 * the argv from newWindow). All running in-process: daemon in the same test
 * process, fake-agent as a child.
 *
 * See spec.md "Testing" section.
 */

import {
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ChildProcess,
  spawn,
} from 'node:child_process';
import { request, subscribe } from './client';
import type { StatePush } from './protocol';
import { FakeTmux } from './tmux';
import { FakeAdapter } from './adapters/fake';
import { stubAdapter } from './adapters/stubs';
import { Daemon } from './daemon/server';
import type { HarnessAdapter, HarnessId, HarnessInfo, Session } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unconfiguredAdapter(id: HarnessId): HarnessAdapter {
  return {
    id,
    capabilities: { remotePermission: false, questionText: false },
    configured: () => false,
    spawnCommand(): string[] {
      throw new Error(`${id} not configured (test stub)`);
    },
  };
}

function makeAdapters(fakeAdapter: FakeAdapter): Record<HarnessId, HarnessAdapter> {
  return {
    fake: fakeAdapter,
    claude: unconfiguredAdapter('claude'),
    codex: unconfiguredAdapter('codex'),
    cursor: stubAdapter('cursor'),
    devin: stubAdapter('devin'),
  };
}

const HARNESSES: HarnessInfo[] = [
  { id: 'fake', configured: true },
  { id: 'claude', configured: false },
  { id: 'codex', configured: false },
  { id: 'cursor', configured: false },
  { id: 'devin', configured: false },
];

/** Wait until predicate is true against the latest push, or timeout. */
async function waitFor(
  pushes: StatePush[],
  predicate: (push: StatePush) => boolean,
  timeoutMs = 3000,
  label = 'condition',
): Promise<StatePush> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const last = pushes[pushes.length - 1];
    if (last && predicate(last)) return last;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  const last = pushes[pushes.length - 1];
  throw new Error(
    `waitFor(${label}) timed out after ${timeoutMs}ms. Last push: ${JSON.stringify(last?.sessions?.map((s) => ({ id: s.id, status: s.status })))}`,
  );
}

function findSession(push: StatePush, id: string): Session | undefined {
  return push.sessions.find((s) => s.id === id);
}

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------

let holoHomeDir: string;
let daemon: Daemon | null = null;
let fakeTmux: FakeTmux;
let child: ChildProcess | null = null;
const pushes: StatePush[] = [];
let sub: { close(): void } | null = null;

// Script: ready → prompt → tool → permission(Bash) → stop
const FAKE_SCRIPT = JSON.stringify([
  { delayMs: 0, event: { kind: 'ready' } },
  { delayMs: 50, event: { kind: 'prompt' } },
  { delayMs: 50, event: { kind: 'tool' } },
  {
    delayMs: 50,
    permission: { tool: 'Bash', input: { command: 'rm -rf /tmp/x' }, timeoutMs: 5000 },
  },
  { delayMs: 50, event: { kind: 'stop', lastMessage: 'fake agent: work complete' } },
]);

beforeEach(async () => {
  // Fresh short tmpdir — macOS unix socket path cap ~104 chars
  holoHomeDir = mkdtempSync(join(tmpdir(), 'holo-e2e-'));
  process.env.HOLO_HOME = holoHomeDir;
  process.env.HOLO_FAKE_SCRIPT = FAKE_SCRIPT;
  pushes.length = 0;

  fakeTmux = new FakeTmux();
  daemon = new Daemon({
    tmux: fakeTmux,
    adapters: makeAdapters(new FakeAdapter()),
    harnesses: HARNESSES,
    tuiArgv: ['true'],
    sweepIntervalMs: 3_600_000, // no auto-sweep; drive manually
  });
  await daemon.start();
});

afterEach(async () => {
  // Kill child process if still alive
  if (child && !child.killed) {
    child.kill('SIGTERM');
    child = null;
  }
  // Close subscription
  sub?.close();
  sub = null;
  // Stop daemon
  if (daemon) {
    await daemon.stop();
    daemon = null;
  }
  // Cleanup env
  delete process.env.HOLO_FAKE_SCRIPT;
  delete process.env.HOLO_HOME;
  // Remove tmpdir
  rmSync(holoHomeDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// E2E test
// ---------------------------------------------------------------------------

it('FakeAgent full lifecycle with permission', async () => {
  // 1. Subscribe to daemon pushes
  sub = subscribe({
    onState: (push) => pushes.push(push),
    onClose: () => {},
  });

  // Wait for initial push
  await waitFor(pushes, (p) => p.sessions !== undefined, 2000, 'initial push');

  // 2. Spawn a fake session
  const spawnRes = await request({ cmd: 'new', harness: 'fake', cwd: holoHomeDir });
  if (!spawnRes.ok || !('session' in spawnRes)) {
    throw new Error(`spawn failed: ${JSON.stringify(spawnRes)}`);
  }
  const sessionId = spawnRes.session.id;
  expect(sessionId).toBe('fake-1');

  // Get the argv recorded by FakeTmux and actually spawn the child
  const windowId = spawnRes.session.tmuxWindow;
  const windowInfo = fakeTmux.windows.get(windowId);
  if (!windowInfo) throw new Error(`FakeTmux has no window ${windowId}`);

  // Spawn the child: argv[0] = bun executable path (process.execPath when tests run under bun)
  const [execPath, ...childArgs] = windowInfo.argv;
  if (!execPath) throw new Error('empty argv');

  const childOut: string[] = [];
  child = spawn(execPath, childArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOLO_HOME: holoHomeDir, HOLO_FAKE_SCRIPT: FAKE_SCRIPT },
  });
  child.stdout?.on('data', (chunk: Buffer) => {
    childOut.push(chunk.toString());
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    // suppress fake-agent stderr in test output, but keep for debugging
    process.stderr.write(`[fake-agent] ${chunk.toString()}`);
  });

  // 3. Wait for: idle (ready) → running (prompt)
  await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'idle';
    },
    2000,
    'idle after ready',
  );

  await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'running';
    },
    2000,
    'running after prompt',
  );

  // 4. Wait for permission state
  const permPush = await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'permission';
    },
    2000,
    'permission state',
  );

  const permSession = findSession(permPush, sessionId);
  expect(permSession?.pendingPermission?.tool).toBe('Bash');

  // Check queue: top item should have score >= 100 and reason 'approve: Bash'
  const queueTop = permPush.queue[0];
  expect(queueTop?.sessionId).toBe(sessionId);
  expect(queueTop?.reason).toBe('approve: Bash');
  expect(queueTop?.score).toBeGreaterThanOrEqual(100);

  // 5. Approve the permission
  const respondRes = await request({ cmd: 'respondPermission', sessionId, allow: true });
  expect(respondRes.ok).toBe(true);

  // 6. Child should output 'allow'
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (childOut.join('').includes('allow')) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
  }
  expect(childOut.join('')).toContain('allow');

  // 7. Wait for running again (after permission resolved)
  await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'running';
    },
    2000,
    'running after permission',
  );

  // 8. Wait for idle with lastMessage
  const idlePush = await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'idle' && s.lastMessage === 'fake agent: work complete';
    },
    2000,
    'idle with lastMessage',
  );

  const idleSession = findSession(idlePush, sessionId);
  expect(idleSession?.lastMessage).toBe('fake agent: work complete');

  // 9. Kill the child process, simulate window close
  child.kill('SIGTERM');
  child = null;

  // FakeTmux still has the window — close it manually
  fakeTmux.closeWindow(windowId);

  // Trigger a sweep — this should detect the window is gone and mark exited
  await daemon!.sweepOnce();

  // 10. Wait for exited state
  await waitFor(
    pushes,
    (p) => {
      const s = findSession(p, sessionId);
      return s?.status === 'exited';
    },
    2000,
    'exited after window close',
  );
}, 10_000);
