import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act, useState } from 'react';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Session } from '../types';
import type { DiffStatRunner } from './diffstat';
import { PreviewPane } from './PreviewPane';
import { renderSetup } from './test-utils';

beforeAll(() => {
  process.env.HOLO_HOME = mkdtempSync(join(tmpdir(), 'holo-ui-'));
});

function session(over: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    id: 'claude-1',
    harness: 'claude',
    cwd: '/Users/x/Development/relos',
    tmuxWindow: '@1',
    status: 'running',
    createdAt: now - 120_000,
    statusSince: now - 30_000,
    ...over,
  };
}

/** Stateful wrapper so tests can push session/now updates like App would. */
async function mountPane(initial: Session) {
  const calls: string[] = [];
  const counter = { n: 0 };
  const diffStat: DiffStatRunner = async (cwd) => {
    calls.push(cwd);
    counter.n += 1;
    return `DIFF ${counter.n}`;
  };
  const setters = { session: (_: Session) => {}, now: (_: number) => {} };
  function Wrapper() {
    const [s, setSession] = useState(initial);
    const [now, setNow] = useState(initial.statusSince + 5_000);
    setters.session = setSession;
    setters.now = setNow;
    return (
      <PreviewPane
        session={s}
        reason={null}
        runningCount={1}
        diffStat={diffStat}
        now={now}
      />
    );
  }
  const el = await renderSetup(<Wrapper />);
  await el.update(); // let the initial diff fetch land
  return { ...el, calls, setters };
}

describe('PreviewPane diff stat', () => {
  it("fetches the diff for the selected session's cwd", async () => {
    const { calls, frame, unmount } = await mountPane(session());
    expect(calls).toEqual(['/Users/x/Development/relos']);
    expect(frame()).toContain('DIFF 1');
    unmount();
  });

  it('refetches when the selected session transitions state', async () => {
    const base = session();
    const { calls, setters, frame, update, unmount } = await mountPane(base);
    expect(calls).toHaveLength(1);
    await act(async () => {
      setters.session({
        ...base,
        status: 'idle',
        statusSince: base.statusSince + 45_000,
      });
    });
    await update();
    expect(calls).toHaveLength(2);
    expect(frame()).toContain('DIFF 2');
    unmount();
  });

  it('does not refetch on time ticks or message-only updates', async () => {
    const base = session();
    const { calls, setters, frame, update, unmount } = await mountPane(base);
    await act(async () => {
      setters.now(Date.now());
      setters.session({ ...base, lastMessage: 'edited three files' });
    });
    await update();
    expect(calls).toHaveLength(1);
    expect(frame()).toContain('edited three files');
    unmount();
  });
});
