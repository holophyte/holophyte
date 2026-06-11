import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessId, HarnessInfo } from '../types';
import type { CwdCandidate } from './cwd-candidates';
import type { SpawnResult } from './NewSessionModal';
import { NewSessionModal } from './NewSessionModal';
import { renderSetup } from './test-utils';

const tmpHome = { path: '' };

beforeAll(() => {
  tmpHome.path = mkdtempSync(join(tmpdir(), 'holo-ui-'));
  process.env.HOLO_HOME = tmpHome.path;
});

const HARNESSES: HarnessInfo[] = [
  { id: 'claude', configured: true },
  { id: 'codex', configured: true },
  { id: 'cursor', configured: false },
];

const CANDIDATES: CwdCandidate[] = [
  {
    path: '/Users/x/Development/relos',
    label: '~/Development/relos',
    annotation: '★ 2 active',
  },
  {
    path: '/Users/x/Development/holophyte',
    label: '~/Development/holophyte',
    annotation: 'recent',
  },
  { path: '/Users/x/Development/bramble', label: '~/Development/bramble' },
];

async function mount(
  over: {
    result?: SpawnResult;
    candidates?: CwdCandidate[];
    /** undefined → accept any path; 'real' → use the component's node:fs default */
    isDirectory?: ((path: string) => boolean) | 'real';
  } = {},
) {
  const submitted: Array<{ harness: HarnessId; cwd: string }> = [];
  const cancels: number[] = [];
  const resultRef = { value: over.result ?? ({ ok: true } as SpawnResult) };
  const isDirectory =
    over.isDirectory === 'real'
      ? undefined
      : (over.isDirectory ?? (() => true));
  const el = await renderSetup(
    <NewSessionModal
      harnesses={HARNESSES}
      candidates={over.candidates ?? CANDIDATES}
      onSubmit={async (harness, cwd) => {
        submitted.push({ harness, cwd });
        return resultRef.value;
      }}
      onCancel={() => cancels.push(1)}
      isDirectory={isDirectory}
    />,
  );
  return { ...el, submitted, cancels, resultRef };
}

describe('NewSessionModal step 1 — harness picker', () => {
  it('lists harnesses in order and dims unconfigured ones', async () => {
    const { frame, unmount } = await mount();
    const out = frame();
    expect(out).toContain('New Session');
    expect(out).toContain('[1] claude');
    expect(out).toContain('[2] codex');
    expect(out).toContain('[3] cursor');
    expect(out).toContain('not configured');
    unmount();
  });

  it('advances to step 2 on a digit', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('2');
    await update();
    expect(frame()).toContain('New codex session — where?');
    unmount();
  });

  it('advances with j/k + enter', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('j'); // claude → codex
    input.pressEnter();
    await update();
    expect(frame()).toContain('New codex session — where?');
    unmount();
  });

  it('ignores digits for unconfigured harnesses', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('3'); // cursor — not configured
    await update();
    expect(frame()).toContain('New Session'); // still on step 1
    expect(frame()).not.toContain('where?');
    unmount();
  });

  it('esc cancels', async () => {
    const { input, cancels, unmount } = await mount();
    await input.pressEscape();
    expect(cancels).toHaveLength(1);
    unmount();
  });
});

describe('NewSessionModal step 2 — cwd picker', () => {
  it('shows ranked candidates with annotations', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    const out = frame();
    expect(out).toContain('~/Development/relos');
    expect(out).toContain('★ 2 active');
    expect(out).toContain('recent');
    unmount();
  });

  it('typing fuzzy-filters the candidate list', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    await input.typeText('holo');
    await update();
    const out = frame();
    expect(out).toContain('~/Development/holophyte');
    expect(out).not.toContain('relos');
    expect(out).not.toContain('bramble');
    unmount();
  });

  it('enter submits the highlighted candidate', async () => {
    const { input, submitted, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    input.pressEnter();
    await update();
    expect(submitted).toEqual([
      { harness: 'claude', cwd: '/Users/x/Development/relos' },
    ]);
    unmount();
  });

  it('arrow keys move the highlight', async () => {
    const { input, submitted, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    input.pressArrow('down');
    await update();
    input.pressEnter();
    await update();
    expect(submitted).toEqual([
      { harness: 'claude', cwd: '/Users/x/Development/holophyte' },
    ]);
    unmount();
  });

  it('tab toggles free-text mode and enter submits an absolute path as-is', async () => {
    const { input, submitted, frame, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    input.pressTab();
    await update();
    expect(frame()).toContain('enter: spawn path');
    await input.typeText('/tmp/scratch');
    input.pressEnter();
    await update();
    expect(submitted).toEqual([{ harness: 'claude', cwd: '/tmp/scratch' }]);
    unmount();
  });

  it('shows the error and stays open on an ok:false response', async () => {
    const { input, frame, update, unmount } = await mount({
      result: { ok: false, error: 'spawn failed: no tmux' },
    });
    input.pressKey('1');
    await update();
    input.pressEnter();
    await update();
    await update(); // onSubmit promise resolution lands one tick later
    const out = frame();
    expect(out).toContain('spawn failed: no tmux');
    expect(out).toContain('where?'); // still on step 2
    unmount();
  });

  it('esc goes back to step 1', async () => {
    const { input, frame, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    await input.pressEscape();
    await update();
    expect(frame()).toContain('New Session');
    expect(frame()).not.toContain('where?');
    unmount();
  });
});

describe('NewSessionModal step 2 — list scrolling', () => {
  const MANY: CwdCandidate[] = Array.from({ length: 12 }, (_, i) => ({
    path: `/Users/x/proj-${String(i).padStart(2, '0')}`,
    label: `~/proj-${String(i).padStart(2, '0')}`,
  }));

  it('scrolls the window so the highlight stays visible past 9 rows', async () => {
    const { input, submitted, frame, update, unmount } = await mount({
      candidates: MANY,
    });
    input.pressKey('1');
    await update();
    for (let i = 0; i < 9; i += 1) input.pressArrow('down');
    await update();
    const out = frame();
    expect(out).toContain('› ~/proj-09'); // highlighted row is rendered
    expect(out).not.toContain('~/proj-00'); // top row scrolled out
    input.pressEnter();
    await update();
    expect(submitted).toEqual([{ harness: 'claude', cwd: '/Users/x/proj-09' }]);
    unmount();
  });

  it('clamps at the last candidate and scrolls back up', async () => {
    const { input, frame, update, unmount } = await mount({ candidates: MANY });
    input.pressKey('1');
    await update();
    for (let i = 0; i < 20; i += 1) input.pressArrow('down');
    await update();
    expect(frame()).toContain('› ~/proj-11');
    for (let i = 0; i < 20; i += 1) input.pressArrow('up');
    await update();
    const out = frame();
    expect(out).toContain('› ~/proj-00');
    expect(out).not.toContain('~/proj-11');
    unmount();
  });
});

describe('NewSessionModal free-text path resolution', () => {
  async function toFreeMode(over: Parameters<typeof mount>[0] = {}) {
    const m = await mount(over);
    m.input.pressKey('1');
    await m.update();
    m.input.pressTab();
    await m.update();
    return m;
  }

  it('expands a leading ~ with the home directory', async () => {
    const { input, submitted, update, unmount } = await toFreeMode();
    await input.typeText('~/scratch');
    input.pressEnter();
    await update();
    expect(submitted).toEqual([
      { harness: 'claude', cwd: join(homedir(), 'scratch') },
    ]);
    unmount();
  });

  it("resolves relative paths against the TUI's cwd", async () => {
    const { input, submitted, update, unmount } = await toFreeMode();
    await input.typeText('scratch/sub');
    input.pressEnter();
    await update();
    expect(submitted).toEqual([
      { harness: 'claude', cwd: resolve('scratch/sub') },
    ]);
    unmount();
  });

  it('rejects a missing directory with an error instead of submitting', async () => {
    const { input, submitted, frame, update, unmount } = await toFreeMode({
      isDirectory: () => false,
    });
    await input.typeText('/tmp/nope');
    input.pressEnter();
    await update();
    expect(submitted).toEqual([]);
    const out = frame();
    expect(out).toContain('no such directory: /tmp/nope');
    expect(out).toContain('where?'); // still on step 2
    unmount();
  });

  it('checks the real filesystem by default', async () => {
    const { input, submitted, frame, update, unmount } = await toFreeMode({
      isDirectory: 'real',
    });
    await input.typeText(join(tmpHome.path, 'missing'));
    input.pressEnter();
    await update();
    expect(submitted).toEqual([]);
    expect(frame()).toContain('no such directory:');
    unmount();
  });

  it('submits an existing directory with the real default check', async () => {
    const { input, submitted, update, unmount } = await toFreeMode({
      isDirectory: 'real',
    });
    await input.typeText(tmpHome.path);
    input.pressEnter();
    await update();
    expect(submitted).toEqual([{ harness: 'claude', cwd: tmpHome.path }]);
    unmount();
  });
});

describe('NewSessionModal in-flight submit guard', () => {
  it('two rapid enters fire onSubmit exactly once', async () => {
    const { input, submitted, update, unmount } = await mount();
    input.pressKey('1');
    await update();
    input.pressEnter();
    input.pressEnter();
    await update();
    expect(submitted).toHaveLength(1);
    unmount();
  });

  it('allows resubmitting after a failed spawn', async () => {
    const { input, submitted, resultRef, frame, update, unmount } = await mount(
      {
        result: { ok: false, error: 'spawn failed: no tmux' },
      },
    );
    input.pressKey('1');
    await update();
    input.pressEnter();
    await update();
    await update(); // onSubmit promise resolution lands one tick later
    expect(frame()).toContain('spawn failed: no tmux');
    resultRef.value = { ok: true };
    input.pressEnter();
    await update();
    expect(submitted).toHaveLength(2);
    unmount();
  });
});
