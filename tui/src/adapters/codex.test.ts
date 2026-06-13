// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { hookCommand } from './claude';
import {
  CodexAdapter,
  codexHookOverride,
  codexVersionSupported,
} from './codex';

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
    expect(
      codexHookOverride('Stop', '/usr/local/bin/bun /a/main.ts codex codex-1'),
    ).toBe(
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

  it('passes the single-quoted HOLO_HOME prefix through unmodified (TOML-safe)', () => {
    expect(
      codexHookOverride(
        'Stop',
        "HOLO_HOME='/h' '/bin/bun' '/a/main.ts' codex codex-1",
      ),
    ).toBe(
      `hooks.Stop=[{hooks=[{type="command",command="HOLO_HOME='/h' '/bin/bun' '/a/main.ts' codex codex-1"}]}]`,
    );
  });
});

describe('codexVersionSupported', () => {
  it.each([
    ['codex-cli 0.139.0', true],
    ['codex-cli 0.139.1', true],
    ['codex-cli 0.140.0', true],
    ['codex-cli 1.0.0', true],
    ['codex-cli 0.137.0', false],
    ['codex-cli 0.99.9', false],
  ])('%s → %s', (output, supported) => {
    expect(codexVersionSupported(output)).toBe(supported);
  });

  it('returns false for null or unparseable output', () => {
    expect(codexVersionSupported(null)).toBe(false);
    expect(codexVersionSupported('')).toBe(false);
    expect(codexVersionSupported('command not found')).toBe(false);
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
    expect(new CodexAdapter({ configured: () => true }).configured()).toBe(
      true,
    );
    expect(new CodexAdapter({ configured: () => false }).configured()).toBe(
      false,
    );
  });

  it('configured() requires codex >= 0.139 from the version probe', () => {
    const withVersion = (output: string | null) =>
      new CodexAdapter({ codexVersion: () => output });
    expect(withVersion('codex-cli 0.139.0').configured()).toBe(true);
    expect(withVersion('codex-cli 0.140.2').configured()).toBe(true);
    // 0.137: `-c hooks.*` injection is silently dead — must gray out, not hang
    expect(withVersion('codex-cli 0.137.0').configured()).toBe(false);
    expect(withVersion(null).configured()).toBe(false);
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
      'check_for_update_on_startup=false',
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

  it('disables the startup update check (the dialog blocks session startup)', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    const overrides = argv.filter((_, i) => argv[i - 1] === '-c');
    expect(overrides).toContain('check_for_update_on_startup=false');
  });

  it('hook overrides embed the generation-time HOLO_HOME prefix', async () => {
    const savedHoloHome = process.env.HOLO_HOME;
    process.env.HOLO_HOME = '/tmp/holo-codex-test';
    try {
      const adapter = new CodexAdapter({ configured: () => true });
      const argv = await adapter.spawnCommand(makeSession());
      const hookOverrides = argv.filter(
        (value, i) => argv[i - 1] === '-c' && value.startsWith('hooks.'),
      );
      expect(hookOverrides).toHaveLength(5);
      for (const override of hookOverrides) {
        expect(override).toContain(
          `command="HOLO_HOME='/tmp/holo-codex-test' `,
        );
      }
    } finally {
      if (savedHoloHome === undefined) delete process.env.HOLO_HOME;
      else process.env.HOLO_HOME = savedHoloHome;
    }
  });

  it('passes session cwd to -C', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(
      makeSession({ cwd: '/tmp/elsewhere' }),
    );
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

  it('resumeCommand puts the verified global flags BEFORE the resume subcommand', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const session = makeSession({ harnessSessionId: 'conv-uuid-7' });
    const command = hookCommand('codex', 'codex-1');

    // flag placement parse-verified against codex 0.139.0 — see
    // docs/hooks-research.md "codex resume flag placement"
    expect(await adapter.resumeCommand(session)).toEqual([
      'codex',
      '-C',
      '/Users/ko/Development/relos',
      '-c',
      'check_for_update_on_startup=false',
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
      'resume',
      'conv-uuid-7',
    ]);
  });

  it('resumeCommand argv is spawnCommand argv plus the resume subcommand', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const session = makeSession({ harnessSessionId: 'conv-uuid-7' });
    expect(await adapter.resumeCommand(session)).toEqual([
      ...(await adapter.spawnCommand(session)),
      'resume',
      'conv-uuid-7',
    ]);
  });

  it('resumeCommand throws without a captured conversation id', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    await expect(adapter.resumeCommand(makeSession())).rejects.toThrow(
      /requires a captured conversation id/,
    );
  });

  it('each -c value is a single argv element parseable as key=value', async () => {
    const adapter = new CodexAdapter({ configured: () => true });
    const argv = await adapter.spawnCommand(makeSession());
    const overrides = argv.filter((_, i) => argv[i - 1] === '-c');
    expect(overrides).toHaveLength(6);
    const [updateCheck, ...hookOverrides] = overrides;
    expect(updateCheck).toBe('check_for_update_on_startup=false');
    expect(hookOverrides).toHaveLength(5);
    for (const override of hookOverrides) {
      expect(override).toMatch(
        /^hooks\.[A-Za-z]+=\[\{hooks=\[\{type="command",command=".+"(,timeout=\d+)?\}\]\}\]$/,
      );
    }
  });
});
