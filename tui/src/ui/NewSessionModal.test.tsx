import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { HarnessId, HarnessInfo } from '../types';
import type { CwdCandidate } from './cwd-candidates';
import type { SpawnResult } from './NewSessionModal';
import { NewSessionModal } from './NewSessionModal';
import { renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-ui-'));
});

const HARNESSES: HarnessInfo[] = [
  { id: 'claude', configured: true },
  { id: 'codex', configured: true },
  { id: 'cursor', configured: false },
];

const CANDIDATES: CwdCandidate[] = [
  { path: '/Users/x/Development/relos', label: '~/Development/relos', annotation: '★ 2 active' },
  { path: '/Users/x/Development/holophyte', label: '~/Development/holophyte', annotation: 'recent' },
  { path: '/Users/x/Development/bramble', label: '~/Development/bramble' },
];

async function mount(over: { result?: SpawnResult } = {}) {
  const submitted: Array<{ harness: HarnessId; cwd: string }> = [];
  const cancels: number[] = [];
  const resultRef = { value: over.result ?? ({ ok: true } as SpawnResult) };
  const el = await renderSetup(
    <NewSessionModal
      harnesses={HARNESSES}
      candidates={CANDIDATES}
      onSubmit={async (harness, cwd) => {
        submitted.push({ harness, cwd });
        return resultRef.value;
      }}
      onCancel={() => cancels.push(1)}
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
    expect(submitted).toEqual([{ harness: 'claude', cwd: '/Users/x/Development/relos' }]);
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
    expect(submitted).toEqual([{ harness: 'claude', cwd: '/Users/x/Development/holophyte' }]);
    unmount();
  });

  it('tab toggles free-text mode and enter submits the literal path', async () => {
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
