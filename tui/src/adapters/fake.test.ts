// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { FakeAdapter } from './fake';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'fake-1',
    harness: 'fake',
    cwd: '/tmp/repo',
    tmuxWindow: '@3',
    status: 'running',
    createdAt: 0,
    statusSince: 0,
    ...overrides,
  };
}

describe('FakeAdapter', () => {
  let holoHomeDir: string;
  const savedHoloHome = process.env.HOLO_HOME;
  const savedScript = process.env.HOLO_FAKE_SCRIPT;

  beforeEach(() => {
    holoHomeDir = mkdtempSync(join(tmpdir(), 'holo-test-'));
    process.env.HOLO_HOME = holoHomeDir;
    delete process.env.HOLO_FAKE_SCRIPT;
  });

  afterEach(() => {
    if (savedHoloHome === undefined) delete process.env.HOLO_HOME;
    else process.env.HOLO_HOME = savedHoloHome;
    if (savedScript === undefined) delete process.env.HOLO_FAKE_SCRIPT;
    else process.env.HOLO_FAKE_SCRIPT = savedScript;
    rmSync(holoHomeDir, { recursive: true, force: true });
  });

  it('is always configured with full capabilities', () => {
    const adapter = new FakeAdapter();
    expect(adapter.id).toBe('fake');
    expect(adapter.configured()).toBe(true);
    expect(adapter.capabilities).toEqual({
      remotePermission: true,
      questionText: true,
    });
  });

  it('spawnCommand runs fake-agent.ts with the session id and holo home', () => {
    const argv = new FakeAdapter().spawnCommand(makeSession());
    expect(argv[0]).toBe(process.execPath);
    expect(argv[1]?.endsWith(`${sep}fake-agent.ts`)).toBe(true);
    expect(argv.slice(2)).toEqual(['fake-1', '--home', holoHomeDir]);
  });

  it('passes HOLO_FAKE_SCRIPT through as --script', () => {
    const script = JSON.stringify([
      { delayMs: 0, event: { kind: 'ready' } },
      { delayMs: 10, permission: { tool: 'Bash', input: { command: 'ls' } } },
    ]);
    process.env.HOLO_FAKE_SCRIPT = script;
    const argv = new FakeAdapter().spawnCommand(makeSession({ id: 'fake-2' }));
    expect(argv.slice(2)).toEqual([
      'fake-2',
      '--home',
      holoHomeDir,
      '--script',
      script,
    ]);
  });

  it('resumeCommand is spawnCommand plus --resume <conversation id>', () => {
    const adapter = new FakeAdapter();
    const session = makeSession({ harnessSessionId: 'conv-9' });
    expect(adapter.resumeCommand(session)).toEqual([
      ...adapter.spawnCommand(session),
      '--resume',
      'conv-9',
    ]);
  });

  it('resumeCommand throws without a captured conversation id', () => {
    expect(() => new FakeAdapter().resumeCommand(makeSession())).toThrow(
      /requires a captured conversation id/,
    );
  });
});
