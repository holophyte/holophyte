import {
  execExitStatus,
  FakeTmux,
  isInsideTmux,
  pickAttachArgs,
  RealTmux,
  shellQuote,
  type TmuxRunner,
} from './tmux';

/** Fake runner capturing exact argv per call; dequeues canned results. */
function fakeRunner(
  results: Array<{ status?: number; stdout?: string; stderr?: string }> = [],
): { runner: TmuxRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: TmuxRunner = async (args) => {
    calls.push(args);
    const next = results.shift() ?? {};
    return {
      status: next.status ?? 0,
      stdout: next.stdout ?? '',
      stderr: next.stderr ?? '',
    };
  };
  return { runner, calls };
}

describe('execExitStatus', () => {
  it('returns the numeric code when tmux ran and exited non-zero', () => {
    expect(execExitStatus({ code: 1 })).toBe(1);
    expect(execExitStatus({ code: 127 })).toBe(127);
  });

  it('returns null for string codes (spawn-level failures)', () => {
    expect(execExitStatus({ code: 'ENOENT' })).toBeNull();
    expect(execExitStatus({ code: 'EAGAIN' })).toBeNull();
    expect(execExitStatus({ code: 'EMFILE' })).toBeNull();
  });

  it('returns null when there is no code (e.g. killed by signal)', () => {
    expect(execExitStatus({})).toBeNull();
    expect(execExitStatus({ code: null })).toBeNull();
  });
});

describe('shellQuote', () => {
  it('quotes args with spaces', () => {
    expect(shellQuote(['echo', 'hello world'])).toBe("'echo' 'hello world'");
  });

  it('escapes embedded single quotes', () => {
    expect(shellQuote(["don't"])).toBe("'don'\\''t'");
  });

  it('preserves double quotes literally', () => {
    expect(shellQuote(['say "hi"'])).toBe('\'say "hi"\'');
  });

  it('prevents $var expansion', () => {
    expect(shellQuote(['$HOME', '${PATH}'])).toBe("'$HOME' '${PATH}'");
  });

  it('renders empty arg as empty quotes', () => {
    expect(shellQuote([''])).toBe("''");
  });

  it('joins multiple args with single spaces', () => {
    expect(shellQuote(['a', 'b', 'c'])).toBe("'a' 'b' 'c'");
  });

  it('returns empty string for empty argv', () => {
    expect(shellQuote([])).toBe('');
  });
});

describe('RealTmux', () => {
  describe('sessionExists', () => {
    it('runs has-session and returns true on exit 0', async () => {
      const { runner, calls } = fakeRunner([{ status: 0 }]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.sessionExists()).resolves.toBe(true);
      expect(calls).toEqual([['has-session', '-t', 'holo']]);
    });

    it('returns false on non-zero exit', async () => {
      const { runner } = fakeRunner([{ status: 1 }]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.sessionExists()).resolves.toBe(false);
    });

    it('uses the configured session name', async () => {
      const { runner, calls } = fakeRunner([{ status: 0 }]);
      const tmux = new RealTmux(runner, 'custom');
      await tmux.sessionExists();
      expect(calls).toEqual([['has-session', '-t', 'custom']]);
    });
  });

  describe('default session name', () => {
    const original = process.env.HOLO_TMUX_SESSION;
    afterEach(() => {
      if (original === undefined) delete process.env.HOLO_TMUX_SESSION;
      else process.env.HOLO_TMUX_SESSION = original;
    });

    it('falls back to tmuxSessionName() from paths', async () => {
      process.env.HOLO_TMUX_SESSION = 'holo-test';
      const { runner, calls } = fakeRunner([{ status: 0 }]);
      const tmux = new RealTmux(runner);
      await tmux.sessionExists();
      expect(calls).toEqual([['has-session', '-t', 'holo-test']]);
    });
  });

  describe('ensureSession', () => {
    it('creates the session when missing, then installs the binding', async () => {
      // has-session fails → new-session → bind-key
      const { runner, calls } = fakeRunner([{ status: 1 }, {}, {}]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.ensureSession(['bun', 'src/index.tsx']);
      expect(calls).toEqual([
        ['has-session', '-t', 'holo'],
        [
          'new-session',
          '-d',
          '-s',
          'holo',
          '-n',
          'tui',
          "'bun' 'src/index.tsx'",
        ],
        ['bind-key', 'Space', 'select-window', '-t', 'holo:tui'],
      ]);
    });

    it('skips creation when the session and tui window exist but still installs the binding', async () => {
      // has-session ok → list-windows shows tui → bind-key
      const { runner, calls } = fakeRunner([
        { status: 0 },
        { status: 0, stdout: 'tui\nclaude-1\n' },
        {},
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.ensureSession(['bun', 'src/index.tsx']);
      expect(calls).toEqual([
        ['has-session', '-t', 'holo'],
        ['list-windows', '-t', 'holo', '-F', '#{window_name}'],
        ['bind-key', 'Space', 'select-window', '-t', 'holo:tui'],
      ]);
    });

    it('respawns a missing tui window when the session survived a TUI quit', async () => {
      // has-session ok → list-windows has only agent windows → new-window → bind-key
      const { runner, calls } = fakeRunner([
        { status: 0 },
        { status: 0, stdout: 'claude-1\ncodex-1\n' },
        {},
        {},
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.ensureSession(['bun', 'src/index.tsx']);
      expect(calls).toEqual([
        ['has-session', '-t', 'holo'],
        ['list-windows', '-t', 'holo', '-F', '#{window_name}'],
        [
          'new-window',
          '-d',
          '-t',
          'holo:',
          '-n',
          'tui',
          "'bun' 'src/index.tsx'",
        ],
        ['bind-key', 'Space', 'select-window', '-t', 'holo:tui'],
      ]);
    });

    it('passes env as -e KEY=VALUE flags to new-session', async () => {
      const { runner, calls } = fakeRunner([{ status: 1 }, {}, {}]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.ensureSession(['bun', 'src/index.tsx'], {
        HOLO_HOME: '/tmp/holo home',
        HOLO_TMUX_SESSION: 'holo',
      });
      expect(calls[1]).toEqual([
        'new-session',
        '-d',
        '-s',
        'holo',
        '-n',
        'tui',
        '-e',
        'HOLO_HOME=/tmp/holo home',
        '-e',
        'HOLO_TMUX_SESSION=holo',
        "'bun' 'src/index.tsx'",
      ]);
    });

    it('passes env as -e flags when respawning the tui window', async () => {
      const { runner, calls } = fakeRunner([
        { status: 0 },
        { status: 0, stdout: 'claude-1\n' },
        {},
        {},
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.ensureSession(['bun', 'src/index.tsx'], {
        HOLO_HOME: '/tmp/h',
      });
      expect(calls[2]).toEqual([
        'new-window',
        '-d',
        '-t',
        'holo:',
        '-n',
        'tui',
        '-e',
        'HOLO_HOME=/tmp/h',
        "'bun' 'src/index.tsx'",
      ]);
    });
  });

  describe('newWindow', () => {
    it('builds the full argv with a single quoted shell-command and returns the trimmed window id', async () => {
      const { runner, calls } = fakeRunner([{ status: 0, stdout: '@3\n' }]);
      const tmux = new RealTmux(runner, 'holo');
      const id = await tmux.newWindow({
        name: 'claude-1',
        cwd: '/tmp/repo',
        argv: ['claude', '--session-id', 'abc 123'],
      });
      expect(id).toBe('@3');
      expect(calls).toEqual([
        [
          'new-window',
          '-d',
          '-t',
          'holo:',
          '-n',
          'claude-1',
          '-c',
          '/tmp/repo',
          '-P',
          '-F',
          '#{window_id}',
          "'claude' '--session-id' 'abc 123'",
        ],
      ]);
    });

    it('throws with stderr on failure', async () => {
      const { runner } = fakeRunner([
        { status: 1, stderr: "can't find session: holo\n" },
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(
        tmux.newWindow({ name: 'x', cwd: '/tmp', argv: ['true'] }),
      ).rejects.toThrow("can't find session: holo");
    });

    it('passes env as -e KEY=VALUE flags', async () => {
      const { runner, calls } = fakeRunner([{ status: 0, stdout: '@4\n' }]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.newWindow({
        name: 'claude-1',
        cwd: '/tmp/repo',
        argv: ['claude'],
        env: { HOLO_HOME: '/tmp/h', HOLO_TMUX_SESSION: 'holo' },
      });
      expect(calls).toEqual([
        [
          'new-window',
          '-d',
          '-t',
          'holo:',
          '-n',
          'claude-1',
          '-c',
          '/tmp/repo',
          '-P',
          '-F',
          '#{window_id}',
          '-e',
          'HOLO_HOME=/tmp/h',
          '-e',
          'HOLO_TMUX_SESSION=holo',
          "'claude'",
        ],
      ]);
    });
  });

  describe('selectWindow', () => {
    it('runs select-window with the window id', async () => {
      const { runner, calls } = fakeRunner([{}]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.selectWindow('@2');
      expect(calls).toEqual([['select-window', '-t', '@2']]);
    });
  });

  describe('listWindowIds', () => {
    it('splits output into trimmed window ids', async () => {
      const { runner, calls } = fakeRunner([
        { status: 0, stdout: '@1\n@2\n@3\n' },
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.listWindowIds()).resolves.toEqual(['@1', '@2', '@3']);
      expect(calls).toEqual([
        ['list-windows', '-t', 'holo', '-F', '#{window_id}'],
      ]);
    });

    it('drops blank lines', async () => {
      const { runner } = fakeRunner([{ status: 0, stdout: '@1\n\n@2\n\n' }]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.listWindowIds()).resolves.toEqual(['@1', '@2']);
    });

    it('returns [] when the session is gone (non-zero exit)', async () => {
      const { runner } = fakeRunner([
        { status: 1, stderr: "can't find session: holo\n" },
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.listWindowIds()).resolves.toEqual([]);
    });

    it('propagates runner rejections (could not ask ≠ session gone)', async () => {
      const runner: TmuxRunner = async () => {
        throw Object.assign(new Error('spawn tmux EAGAIN'), {
          code: 'EAGAIN',
        });
      };
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.listWindowIds()).rejects.toThrow('spawn tmux EAGAIN');
    });
  });

  describe('setStatusRight', () => {
    it('sets status-right-length and status-right in one invocation', async () => {
      const { runner, calls } = fakeRunner([{}]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.setStatusRight('#[dim]x#[default]');
      expect(calls).toEqual([
        [
          'set-option',
          '-t',
          'holo',
          'status-right-length',
          '80',
          ';',
          'set-option',
          '-t',
          'holo',
          'status-right',
          '#[dim]x#[default]',
        ],
      ]);
    });

    it('uses the configured session name', async () => {
      const { runner, calls } = fakeRunner([{}]);
      const tmux = new RealTmux(runner, 'custom');
      await tmux.setStatusRight('x');
      expect(calls).toEqual([
        [
          'set-option',
          '-t',
          'custom',
          'status-right-length',
          '80',
          ';',
          'set-option',
          '-t',
          'custom',
          'status-right',
          'x',
        ],
      ]);
    });

    it('resolves on non-zero exit (session gone is normal)', async () => {
      const { runner } = fakeRunner([
        { status: 1, stderr: 'session not found' },
      ]);
      const tmux = new RealTmux(runner, 'holo');
      await expect(tmux.setStatusRight('x')).resolves.toBeUndefined();
    });
  });

  describe('installReturnBinding', () => {
    it('binds prefix+Space to select the tui window', async () => {
      const { runner, calls } = fakeRunner([{}]);
      const tmux = new RealTmux(runner, 'holo');
      await tmux.installReturnBinding();
      expect(calls).toEqual([
        ['bind-key', 'Space', 'select-window', '-t', 'holo:tui'],
      ]);
    });

    it('respects HOLO_RETURN_KEY (spec: binding key is configurable)', async () => {
      const saved = process.env.HOLO_RETURN_KEY;
      process.env.HOLO_RETURN_KEY = 'C-g';
      try {
        const { runner, calls } = fakeRunner([{}]);
        const tmux = new RealTmux(runner, 'holo');
        await tmux.installReturnBinding();
        expect(calls).toEqual([
          ['bind-key', 'C-g', 'select-window', '-t', 'holo:tui'],
        ]);
      } finally {
        if (saved === undefined) delete process.env.HOLO_RETURN_KEY;
        else process.env.HOLO_RETURN_KEY = saved;
      }
    });
  });
});

describe('FakeTmux', () => {
  it('starts with no session, no windows, and no tui window', async () => {
    const tmux = new FakeTmux();
    await expect(tmux.sessionExists()).resolves.toBe(false);
    await expect(tmux.listWindowIds()).resolves.toEqual([]);
    expect(tmux.selected).toBeNull();
    expect(tmux.tuiWindow).toBeNull();
  });

  it('ensureSession creates the session, models the tui window, and records the call', async () => {
    const tmux = new FakeTmux();
    await tmux.ensureSession(['bun', 'src/index.tsx']);
    await expect(tmux.sessionExists()).resolves.toBe(true);
    expect(tmux.tuiWindow).toEqual({ argv: ['bun', 'src/index.tsx'] });
    expect(tmux.calls).toEqual([
      { method: 'ensureSession', args: [['bun', 'src/index.tsx']] },
    ]);
  });

  it('ensureSession records env and stores it on the tui window', async () => {
    const tmux = new FakeTmux();
    await tmux.ensureSession(['bun', 'src/index.tsx'], {
      HOLO_HOME: '/tmp/h',
    });
    expect(tmux.tuiWindow).toEqual({
      argv: ['bun', 'src/index.tsx'],
      env: { HOLO_HOME: '/tmp/h' },
    });
    expect(tmux.calls).toEqual([
      {
        method: 'ensureSession',
        args: [['bun', 'src/index.tsx'], { HOLO_HOME: '/tmp/h' }],
      },
    ]);
  });

  it('ensureSession respawns the tui window after closeTuiWindow', async () => {
    const tmux = new FakeTmux();
    await tmux.ensureSession(['bun', 'src/index.tsx']);
    tmux.closeTuiWindow();
    expect(tmux.tuiWindow).toBeNull();
    await tmux.ensureSession(['bun', 'src/index.tsx']);
    expect(tmux.tuiWindow).toEqual({ argv: ['bun', 'src/index.tsx'] });
  });

  it('ensureSession keeps an existing tui window (a running TUI is not replaced)', async () => {
    const tmux = new FakeTmux();
    await tmux.ensureSession(['bun', 'old.tsx']);
    await tmux.ensureSession(['bun', 'new.tsx']);
    expect(tmux.tuiWindow).toEqual({ argv: ['bun', 'old.tsx'] });
  });

  it('installReturnBinding records the call', async () => {
    const tmux = new FakeTmux();
    await tmux.installReturnBinding();
    expect(tmux.calls).toEqual([{ method: 'installReturnBinding', args: [] }]);
  });

  it('setStatusRight records the call and stores the text', async () => {
    const tmux = new FakeTmux();
    expect(tmux.statusRight).toBeNull();
    await tmux.setStatusRight('text');
    expect(tmux.statusRight).toBe('text');
    expect(tmux.calls).toEqual([{ method: 'setStatusRight', args: ['text'] }]);
  });

  it('round-trips newWindow → listWindowIds → closeWindow → listWindowIds', async () => {
    const tmux = new FakeTmux();
    const id1 = await tmux.newWindow({
      name: 'claude-1',
      cwd: '/tmp/a',
      argv: ['claude'],
    });
    const id2 = await tmux.newWindow({
      name: 'codex-1',
      cwd: '/tmp/b',
      argv: ['codex', '-C', '/tmp/b'],
    });
    expect(id1).toBe('@1');
    expect(id2).toBe('@2');
    expect(tmux.windows.get('@1')).toEqual({
      name: 'claude-1',
      cwd: '/tmp/a',
      argv: ['claude'],
    });
    await expect(tmux.listWindowIds()).resolves.toEqual(['@1', '@2']);

    tmux.closeWindow('@1');
    await expect(tmux.listWindowIds()).resolves.toEqual(['@2']);
  });

  it('newWindow records env on the window', async () => {
    const tmux = new FakeTmux();
    await tmux.newWindow({
      name: 'claude-1',
      cwd: '/tmp/a',
      argv: ['claude'],
      env: { HOLO_HOME: '/tmp/h' },
    });
    expect(tmux.windows.get('@1')).toEqual({
      name: 'claude-1',
      cwd: '/tmp/a',
      argv: ['claude'],
      env: { HOLO_HOME: '/tmp/h' },
    });
  });

  it('selectWindow tracks the selected window id', async () => {
    const tmux = new FakeTmux();
    const id = await tmux.newWindow({ name: 'w', cwd: '/tmp', argv: ['true'] });
    await tmux.selectWindow(id);
    expect(tmux.selected).toBe(id);
  });

  it('closeWindow clears selection when the selected window dies', async () => {
    const tmux = new FakeTmux();
    const id = await tmux.newWindow({ name: 'w', cwd: '/tmp', argv: ['true'] });
    await tmux.selectWindow(id);
    tmux.closeWindow(id);
    expect(tmux.selected).toBeNull();
  });

  it('never reuses window ids after close', async () => {
    const tmux = new FakeTmux();
    const id1 = await tmux.newWindow({ name: 'a', cwd: '/t', argv: ['x'] });
    tmux.closeWindow(id1);
    const id2 = await tmux.newWindow({ name: 'b', cwd: '/t', argv: ['y'] });
    expect(id2).toBe('@2');
  });
});

describe('isInsideTmux', () => {
  const original = process.env.TMUX;
  afterEach(() => {
    if (original === undefined) delete process.env.TMUX;
    else process.env.TMUX = original;
  });

  it('returns true when TMUX is set', () => {
    process.env.TMUX = '/private/tmp/tmux-501/default,12345,0';
    expect(isInsideTmux()).toBe(true);
  });

  it('returns false when TMUX is unset', () => {
    delete process.env.TMUX;
    expect(isInsideTmux()).toBe(false);
  });
});

describe('pickAttachArgs', () => {
  it('switches client when already inside tmux', () => {
    expect(pickAttachArgs(true, 'holo')).toEqual([
      'switch-client',
      '-t',
      'holo',
    ]);
  });

  it('attaches when outside tmux', () => {
    expect(pickAttachArgs(false, 'holo')).toEqual([
      'attach-session',
      '-t',
      'holo',
    ]);
  });
});
