// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sessionSettingsPath } from '../paths';
import type { Session } from '../types';
import { buildClaudeSettings, ClaudeAdapter, hookCommand } from './claude';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'claude-1',
    harness: 'claude',
    cwd: '/tmp/some-repo',
    tmuxWindow: '@1',
    status: 'running',
    createdAt: 0,
    statusSince: 0,
    ...overrides,
  };
}

describe('hookCommand', () => {
  const savedHoloHome = process.env.HOLO_HOME;

  afterEach(() => {
    if (savedHoloHome === undefined) delete process.env.HOLO_HOME;
    else process.env.HOLO_HOME = savedHoloHome;
  });

  it('prefixes the generation-time HOLO_HOME, then bun + hook main + harness + session id', () => {
    process.env.HOLO_HOME = '/custom/holo-home';
    const mainPath = fileURLToPath(new URL('../hook/main.ts', import.meta.url));
    expect(hookCommand('claude', 'claude-1')).toBe(
      `HOLO_HOME='/custom/holo-home' '${process.execPath}' '${mainPath}' 'claude' 'claude-1'`,
    );
  });

  it('pins HOLO_HOME to ~/.holo when the env var is unset', () => {
    delete process.env.HOLO_HOME;
    expect(hookCommand('claude', 'claude-1')).toMatch(
      /^HOLO_HOME='[^ ]*\/\.holo' /,
    );
  });

  it('shell-quotes a home path containing single quotes', () => {
    process.env.HOLO_HOME = "/tmp/ko's home";
    expect(hookCommand('claude', 'claude-1')).toMatch(
      /^HOLO_HOME='\/tmp\/ko'\\''s home' /,
    );
  });

  it('points at src/hook/main.ts and quotes harness + session id', () => {
    expect(hookCommand('codex', 'codex-2')).toMatch(
      /\/src\/hook\/main\.ts' 'codex' 'codex-2'$/,
    );
  });
});

describe('buildClaudeSettings', () => {
  const settings = buildClaudeSettings('CMD') as {
    preferredNotifChannel: string;
    hooks: Record<
      string,
      Array<{
        hooks: Array<{ type: string; command: string; timeout?: number }>;
      }>
    >;
  };

  it('disables OS notifications so hooks are the single signal source', () => {
    expect(settings.preferredNotifChannel).toBe('notifications_disabled');
  });

  it('registers exactly the seven holo hook events', () => {
    expect(Object.keys(settings.hooks).sort()).toEqual(
      [
        'Notification',
        'PermissionRequest',
        'PreToolUse',
        'SessionEnd',
        'SessionStart',
        'Stop',
        'UserPromptSubmit',
      ].sort(),
    );
  });

  it.each([
    'SessionStart',
    'UserPromptSubmit',
    'PreToolUse',
    'Notification',
    'Stop',
    'SessionEnd',
  ])('%s entry is a single command hook without timeout', (event) => {
    expect(settings.hooks[event]).toEqual([
      { hooks: [{ type: 'command', command: 'CMD' }] },
    ]);
  });

  it('PermissionRequest hook has a 150s timeout exceeding the 90s daemon hold', () => {
    expect(settings.hooks.PermissionRequest).toEqual([
      { hooks: [{ type: 'command', command: 'CMD', timeout: 150 }] },
    ]);
  });

  it('survives a JSON round-trip (what actually lands in the settings file)', () => {
    expect(JSON.parse(JSON.stringify(settings))).toEqual(settings);
  });
});

describe('ClaudeAdapter', () => {
  let holoHomeDir: string;
  const savedHoloHome = process.env.HOLO_HOME;

  beforeEach(() => {
    holoHomeDir = mkdtempSync(join(tmpdir(), 'holo-test-'));
    process.env.HOLO_HOME = holoHomeDir;
  });

  afterEach(() => {
    if (savedHoloHome === undefined) delete process.env.HOLO_HOME;
    else process.env.HOLO_HOME = savedHoloHome;
    rmSync(holoHomeDir, { recursive: true, force: true });
  });

  it('has id claude and full remote capabilities', () => {
    const adapter = new ClaudeAdapter();
    expect(adapter.id).toBe('claude');
    expect(adapter.capabilities).toEqual({
      remotePermission: true,
      questionText: true,
    });
  });

  it('configured() uses the injected checker', () => {
    expect(new ClaudeAdapter({ configured: () => true }).configured()).toBe(
      true,
    );
    expect(new ClaudeAdapter({ configured: () => false }).configured()).toBe(
      false,
    );
  });

  it('spawnCommand writes settings under HOLO_HOME and returns the claude argv', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    const session = makeSession({
      harnessSessionId: 'a1b2c3d4-0000-4000-8000-000000000000',
    });

    const argv = await adapter.spawnCommand(session);
    const settingsPath = sessionSettingsPath('claude-1');

    expect(argv).toEqual([
      'claude',
      '--session-id',
      'a1b2c3d4-0000-4000-8000-000000000000',
      '--settings',
      settingsPath,
    ]);
    expect(settingsPath.startsWith(holoHomeDir)).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);

    const written = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(written).toEqual(
      JSON.parse(
        JSON.stringify(buildClaudeSettings(hookCommand('claude', 'claude-1'))),
      ),
    );
  });

  it('spawnCommand generates a valid UUID when harnessSessionId is unset', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    expect(argv[0]).toBe('claude');
    expect(argv[1]).toBe('--session-id');
    expect(argv[2]).toMatch(UUID_RE);
  });

  it('written hook command targets this session', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    await adapter.spawnCommand(makeSession({ id: 'claude-7' }));
    const written = readFileSync(sessionSettingsPath('claude-7'), 'utf8');
    expect(written).toContain("'claude' 'claude-7'");
  });

  it('written hook commands carry the HOLO_HOME prefix through the JSON embedding', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    await adapter.spawnCommand(makeSession());
    const written = readFileSync(sessionSettingsPath('claude-1'), 'utf8');
    expect(written).toContain(`HOLO_HOME='${holoHomeDir}'`);
  });

  it('resumeCommand returns claude --resume with settings written under the NEW session id', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    const session = makeSession({
      id: 'claude-9',
      harnessSessionId: 'a1b2c3d4-0000-4000-8000-000000000000',
    });

    const argv = await adapter.resumeCommand(session);
    const settingsPath = sessionSettingsPath('claude-9');

    expect(argv).toEqual([
      'claude',
      '--resume',
      'a1b2c3d4-0000-4000-8000-000000000000',
      '--settings',
      settingsPath,
    ]);
    expect(existsSync(settingsPath)).toBe(true);
    // injected hooks must target the NEW holo session id, not the old one
    const written = readFileSync(settingsPath, 'utf8');
    expect(written).toContain("'claude' 'claude-9'");
    expect(JSON.parse(written)).toEqual(
      JSON.parse(
        JSON.stringify(buildClaudeSettings(hookCommand('claude', 'claude-9'))),
      ),
    );
  });

  it('resumeCommand throws without a captured conversation id', async () => {
    const adapter = new ClaudeAdapter({ configured: () => true });
    await expect(adapter.resumeCommand(makeSession())).rejects.toThrow(
      /requires a captured conversation id/,
    );
  });
});
