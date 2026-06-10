// @vitest-environment node
import type { Session } from '../types';
import { hookCommand } from './claude';
import { CodexAdapter, codexHookOverride } from './codex';

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'codex-1',
    harness: 'codex',
    cwd: '/Users/ko/Development/relos',
    tmuxWindow: '@2',
    status: 'running',
    createdAt: 0,
    statusSince: 0,
    ...overrides,
  };
}

describe('codexHookOverride', () => {
  it('builds the exact inline-TOML override string', () => {
    expect(codexHookOverride('Stop', '/usr/local/bin/bun /a/main.ts codex codex-1')).toBe(
      'hooks.Stop=[{hooks=[{type="command",command="/usr/local/bin/bun /a/main.ts codex codex-1"}]}]',
    );
  });

  it('appends timeout inside the hook table when given', () => {
    expect(codexHookOverride('PermissionRequest', 'cmd', 150)).toBe(
      'hooks.PermissionRequest=[{hooks=[{type="command",command="cmd",timeout=150}]}]',
    );
  });

  it('escapes double quotes for TOML basic strings', () => {
    expect(codexHookOverride('Stop', 'echo "hi"')).toBe(
      'hooks.Stop=[{hooks=[{type="command",command="echo \\"hi\\""}]}]',
    );
  });

  it('escapes backslashes for TOML basic strings', () => {
    expect(codexHookOverride('Stop', 'C:\\bun\\bun.exe')).toBe(
      'hooks.Stop=[{hooks=[{type="command",command="C:\\\\bun\\\\bun.exe"}]}]',
    );
  });

  it('escapes backslash before quote without double-escaping', () => {
    // input: say \" → TOML: say \\\"
    expect(codexHookOverride('Stop', 'say \\"')).toBe(
      'hooks.Stop=[{hooks=[{type="command",command="say \\\\\\""}]}]',
    );
  });
});

describe('CodexAdapter', () => {
  it('has id codex with remote permission but no question text', () => {
    const adapter = new CodexAdapter();
    expect(adapter.id).toBe('codex');
    expect(adapter.capabilities).toEqual({
      remotePermission: true,
      questionText: false,
    });
  });

  it('configured() uses the injected checker', () => {
    expect(new CodexAdapter({ configured: () => true }).configured()).toBe(true);
    expect(new CodexAdapter({ configured: () => false }).configured()).toBe(false);
  });

  it('spawnCommand builds the full argv in the verified order', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const session = makeSession();
    const command = hookCommand('codex', 'codex-1');

    expect(await adapter.spawnCommand(session)).toEqual([
      'codex',
      '-C',
      '/Users/ko/Development/relos',
      '-c',
      codexHookOverride('UserPromptSubmit', command),
      '-c',
      codexHookOverride('PreToolUse', command),
      '-c',
      codexHookOverride('PermissionRequest', command, 150),
      '-c',
      codexHookOverride('Stop', command),
      '-c',
      codexHookOverride('SessionStart', command),
      '--dangerously-bypass-hook-trust',
    ]);
  });

  it('passes session cwd to -C', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession({ cwd: '/tmp/elsewhere' }));
    expect(argv[1]).toBe('-C');
    expect(argv[2]).toBe('/tmp/elsewhere');
  });

  it('includes the hook-trust bypass flag (injected hooks are skipped otherwise)', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    expect(argv.at(-1)).toBe('--dangerously-bypass-hook-trust');
  });

  it('never touches the notify config or writes global codex config', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    expect(argv.join(' ')).not.toContain('notify');
    expect(adapter.setup).toBeUndefined();
  });

  it('each -c value is a single argv element parseable as key=value', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    const overrides = argv.filter((_, i) => argv[i - 1] === '-c');
    expect(overrides).toHaveLength(5);
    for (const override of overrides) {
      expect(override).toMatch(/^hooks\.[A-Za-z]+=\[\{hooks=\[\{type="command",command=".+"(,timeout=\d+)?\}\]\}\]$/);
    }
  });
});
