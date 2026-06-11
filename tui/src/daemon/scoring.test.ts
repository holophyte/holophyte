import type { Session } from '../types';
import { buildQueue, scoreSession } from './scoring';

const NOW = 10_000_000;
const MIN = 60_000;

function makeSession(overrides: Partial<Session> & { id: string }): Session {
  return {
    harness: 'claude',
    cwd: '/repo',
    tmuxWindow: '@1',
    status: 'idle',
    createdAt: NOW - MIN,
    statusSince: NOW,
    ...overrides,
  };
}

describe('scoreSession', () => {
  it('applies effort weights per status', () => {
    expect(
      scoreSession(makeSession({ id: 'a', status: 'permission' }), NOW),
    ).toBe(100);
    expect(
      scoreSession(makeSession({ id: 'a', status: 'needs_input' }), NOW),
    ).toBe(60);
    expect(scoreSession(makeSession({ id: 'a', status: 'error' }), NOW)).toBe(
      50,
    );
    expect(scoreSession(makeSession({ id: 'a', status: 'idle' }), NOW)).toBe(
      30,
    );
  });

  it('scores ineligible statuses as 0', () => {
    expect(scoreSession(makeSession({ id: 'a', status: 'running' }), NOW)).toBe(
      0,
    );
    expect(scoreSession(makeSession({ id: 'a', status: 'exited' }), NOW)).toBe(
      0,
    );
  });

  it('adds +2 per full minute waiting', () => {
    const s = (sinceAgoMs: number) =>
      scoreSession(
        makeSession({ id: 'a', status: 'idle', statusSince: NOW - sinceAgoMs }),
        NOW,
      );
    expect(s(0)).toBe(30);
    expect(s(MIN - 1)).toBe(30); // partial minute doesn't count
    expect(s(MIN)).toBe(32); // exactly one full minute
    expect(s(90_000)).toBe(32); // 1.5 min floors to 1
    expect(s(5 * MIN)).toBe(40);
  });

  it('caps the aging bonus at +40', () => {
    const s = (sinceAgoMs: number) =>
      scoreSession(
        makeSession({ id: 'a', status: 'idle', statusSince: NOW - sinceAgoMs }),
        NOW,
      );
    expect(s(20 * MIN)).toBe(70);
    expect(s(21 * MIN)).toBe(70);
    expect(s(1000 * MIN)).toBe(70);
  });

  it('clamps a future statusSince to zero aging', () => {
    const session = makeSession({
      id: 'a',
      status: 'idle',
      statusSince: NOW + 5 * MIN,
    });
    expect(scoreSession(session, NOW)).toBe(30);
  });
});

describe('buildQueue', () => {
  it('excludes running and exited sessions', () => {
    const queue = buildQueue(
      [
        makeSession({ id: 'claude-1', status: 'running' }),
        makeSession({ id: 'claude-2', status: 'exited' }),
        makeSession({ id: 'claude-3', status: 'idle' }),
      ],
      NOW,
    );
    expect(queue.map((q) => q.sessionId)).toEqual(['claude-3']);
  });

  it('returns empty for no eligible sessions', () => {
    expect(
      buildQueue([makeSession({ id: 'a', status: 'running' })], NOW),
    ).toEqual([]);
    expect(buildQueue([], NOW)).toEqual([]);
  });

  it('uses "approve: <tool>" for permission items', () => {
    const queue = buildQueue(
      [
        makeSession({
          id: 'claude-1',
          status: 'permission',
          attentionReason: 'approve: Bash',
          pendingPermission: {
            tool: 'Bash',
            input: { command: 'ls' },
            respondBy: NOW + 1000,
          },
        }),
      ],
      NOW,
    );
    expect(queue[0]?.reason).toBe('approve: Bash');
  });

  it('falls back to attentionReason then "approve" for permission without pendingPermission', () => {
    const withReason = buildQueue(
      [
        makeSession({
          id: 'a',
          status: 'permission',
          attentionReason: 'approve: Edit',
        }),
      ],
      NOW,
    );
    expect(withReason[0]?.reason).toBe('approve: Edit');
    const bare = buildQueue(
      [makeSession({ id: 'a', status: 'permission' })],
      NOW,
    );
    expect(bare[0]?.reason).toBe('approve');
  });

  it('computes reasons per status with fallbacks', () => {
    const reason = (session: Session) => buildQueue([session], NOW)[0]?.reason;
    expect(
      reason(
        makeSession({
          id: 'a',
          status: 'needs_input',
          attentionReason: 'Pick a name',
        }),
      ),
    ).toBe('Pick a name');
    expect(reason(makeSession({ id: 'a', status: 'needs_input' }))).toBe(
      'needs input',
    );
    expect(
      reason(
        makeSession({
          id: 'a',
          status: 'idle',
          attentionReason: 'awaiting first prompt',
        }),
      ),
    ).toBe('awaiting first prompt');
    expect(reason(makeSession({ id: 'a', status: 'idle' }))).toBe(
      'review / next prompt',
    );
    expect(
      reason(
        makeSession({ id: 'a', status: 'error', attentionReason: 'crashed' }),
      ),
    ).toBe('crashed');
    expect(reason(makeSession({ id: 'a', status: 'error' }))).toBe('error');
  });

  it('sorts by score descending', () => {
    const queue = buildQueue(
      [
        makeSession({ id: 'claude-1', status: 'idle' }),
        makeSession({ id: 'claude-2', status: 'permission' }),
        makeSession({ id: 'claude-3', status: 'needs_input' }),
        makeSession({ id: 'claude-4', status: 'error' }),
      ],
      NOW,
    );
    expect(queue.map((q) => q.sessionId)).toEqual([
      'claude-2',
      'claude-3',
      'claude-4',
      'claude-1',
    ]);
  });

  it('breaks score ties by older statusSince first', () => {
    // both needs_input at the aging cap → identical scores
    const queue = buildQueue(
      [
        makeSession({
          id: 'claude-1',
          status: 'needs_input',
          statusSince: NOW - 25 * MIN,
        }),
        makeSession({
          id: 'claude-2',
          status: 'needs_input',
          statusSince: NOW - 30 * MIN,
        }),
      ],
      NOW,
    );
    expect(queue.map((q) => q.sessionId)).toEqual(['claude-2', 'claude-1']);
  });

  it('ranks a fresh permission above an aged needs_input on a score tie', () => {
    // permission (100 + 0 aging) ties needs_input (60 + 40 capped aging) —
    // "permissions jump the queue" wins over the statusSince tie-break
    const queue = buildQueue(
      [
        makeSession({
          id: 'claude-2',
          status: 'needs_input',
          statusSince: NOW - 20 * MIN,
        }),
        makeSession({ id: 'claude-1', status: 'permission', statusSince: NOW }),
      ],
      NOW,
    );
    expect(queue[0]?.score).toBe(100);
    expect(queue[1]?.score).toBe(100);
    expect(queue.map((q) => q.sessionId)).toEqual(['claude-1', 'claude-2']);
  });

  it('breaks score ties between non-permission statuses by older statusSince', () => {
    // error aged 5 min (50 + 10) ties a fresh needs_input (60 + 0)
    const queue = buildQueue(
      [
        makeSession({
          id: 'claude-1',
          status: 'needs_input',
          statusSince: NOW,
        }),
        makeSession({
          id: 'claude-2',
          status: 'error',
          statusSince: NOW - 5 * MIN,
        }),
      ],
      NOW,
    );
    expect(queue[0]?.score).toBe(60);
    expect(queue[1]?.score).toBe(60);
    expect(queue.map((q) => q.sessionId)).toEqual(['claude-2', 'claude-1']);
  });

  it('breaks remaining ties by id ascending', () => {
    const since = NOW - 2 * MIN;
    const queue = buildQueue(
      [
        makeSession({ id: 'codex-1', status: 'idle', statusSince: since }),
        makeSession({ id: 'claude-2', status: 'idle', statusSince: since }),
        makeSession({ id: 'claude-1', status: 'idle', statusSince: since }),
      ],
      NOW,
    );
    expect(queue.map((q) => q.sessionId)).toEqual([
      'claude-1',
      'claude-2',
      'codex-1',
    ]);
  });

  it('includes the score on each item', () => {
    const queue = buildQueue(
      [
        makeSession({
          id: 'a',
          status: 'needs_input',
          statusSince: NOW - 3 * MIN,
        }),
      ],
      NOW,
    );
    expect(queue[0]?.score).toBe(66);
  });
});
