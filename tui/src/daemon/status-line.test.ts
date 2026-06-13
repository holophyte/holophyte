import { describe, expect, it } from 'vitest';
import type { QueueItem, Session, SessionStatus } from '../types';
import {
  renderStatusLine,
  STATUS_STOPPED_LINE,
  sanitizeStatusText,
} from './status-line';

const BRAND = '#[fg=#4EA876,bold]holo#[default]';
const POINTER = '#[fg=#4EA876]▸#[default]';

function session(
  id: string,
  status: SessionStatus,
  extra: Partial<Session> = {},
): Session {
  return {
    id,
    harness: 'claude',
    cwd: '/repo/a',
    tmuxWindow: '@1',
    status,
    createdAt: 0,
    statusSince: 0,
    ...extra,
  };
}

function item(sessionId: string, score: number, reason: string): QueueItem {
  return { sessionId, score, reason };
}

describe('renderStatusLine', () => {
  it('renders the worked example: 1 permission, 2 running, 1 idle', () => {
    const sessions = [
      session('claude-1', 'permission', {
        pendingPermission: { tool: 'Bash', input: null, respondBy: 5000 },
      }),
      session('claude-2', 'running'),
      session('codex-1', 'running'),
      session('claude-3', 'idle'),
    ];
    const queue = [
      item('claude-1', 100, 'approve: Bash'),
      item('claude-3', 30, 'review / next prompt'),
    ];
    expect(renderStatusLine(sessions, queue)).toBe(
      `${BRAND} #[fg=yellow,bold]1 perm#[default] #[dim]2 run 1 idle#[default] ${POINTER} claude-1 #[dim]approve: Bash#[default]`,
    );
  });

  it('renders "no sessions" for an empty board', () => {
    expect(renderStatusLine([], [])).toBe(
      `${BRAND} #[dim]no sessions#[default]`,
    );
  });

  it('treats an only-exited board as "no sessions"', () => {
    const sessions = [
      session('claude-1', 'exited'),
      session('codex-1', 'exited'),
    ];
    expect(renderStatusLine(sessions, [])).toBe(
      `${BRAND} #[dim]no sessions#[default]`,
    );
  });

  it('renders "nothing needs you" when only running sessions remain', () => {
    const sessions = [
      session('claude-1', 'running'),
      session('claude-2', 'running'),
      session('codex-1', 'running'),
    ];
    expect(renderStatusLine(sessions, [])).toBe(
      `${BRAND} #[dim]3 run#[default] ${POINTER} #[dim]nothing needs you#[default]`,
    );
  });

  it('orders buckets perm → need → err and omits zero buckets', () => {
    const sessions = [
      session('claude-1', 'permission', {
        pendingPermission: { tool: 'Edit', input: null, respondBy: 5000 },
      }),
      session('claude-2', 'needs_input'),
      session('codex-1', 'error'),
    ];
    const queue = [
      item('claude-1', 100, 'approve: Edit'),
      item('claude-2', 60, 'needs input'),
      item('codex-1', 50, 'error'),
    ];
    expect(renderStatusLine(sessions, queue)).toBe(
      `${BRAND} #[fg=yellow,bold]1 perm#[default] #[fg=yellow]1 need#[default] #[fg=red]1 err#[default] ${POINTER} claude-1 #[dim]approve: Edit#[default]`,
    );
  });

  it('omits the idle half of the dim segment when zero', () => {
    const sessions = [
      session('claude-1', 'needs_input'),
      session('claude-2', 'running'),
      session('codex-1', 'running'),
    ];
    const queue = [item('claude-1', 60, 'needs input')];
    expect(renderStatusLine(sessions, queue)).toBe(
      `${BRAND} #[fg=yellow]1 need#[default] #[dim]2 run#[default] ${POINTER} claude-1 #[dim]needs input#[default]`,
    );
  });

  it('omits the run half of the dim segment when zero', () => {
    const sessions = [session('claude-1', 'idle')];
    const queue = [item('claude-1', 30, 'starting…')];
    expect(renderStatusLine(sessions, queue)).toBe(
      `${BRAND} #[dim]1 idle#[default] ${POINTER} claude-1 #[dim]starting…#[default]`,
    );
  });

  it('sanitizes the top reason (agent-derived text)', () => {
    const sessions = [session('claude-1', 'needs_input')];
    const queue = [item('claude-1', 60, '#(rm -rf ~)')];
    expect(renderStatusLine(sessions, queue)).toBe(
      `${BRAND} #[fg=yellow]1 need#[default] ${POINTER} claude-1 #[dim]##(rm -rf ~)#[default]`,
    );
  });

  it('sanitizes the top session id (future-proofing harness names)', () => {
    const sessions = [session('my#harness-1', 'idle')];
    const queue = [item('my#harness-1', 30, 'review / next prompt')];
    expect(renderStatusLine(sessions, queue)).toContain(
      `${POINTER} my##harness-1 `,
    );
  });
});

describe('STATUS_STOPPED_LINE', () => {
  it('is the branded tombstone', () => {
    expect(STATUS_STOPPED_LINE).toBe(`${BRAND} #[dim]holod stopped#[default]`);
  });
});

describe('sanitizeStatusText', () => {
  it('neutralizes #() command injection', () => {
    expect(sanitizeStatusText('#(rm -rf ~)', 24)).toBe('##(rm -rf ~)');
  });

  it('neutralizes #[] style injection', () => {
    expect(sanitizeStatusText('#[fg=red]x', 24)).toBe('##[fg=red]x');
  });

  it('neutralizes % so strftime cannot expand it', () => {
    expect(sanitizeStatusText('tests 80% done', 24)).toBe('tests 80%% done');
  });

  it('collapses newlines and tabs to single spaces', () => {
    expect(sanitizeStatusText('a\nb\tc', 24)).toBe('a b c');
  });

  it('strips control characters', () => {
    expect(sanitizeStatusText('a\u0007b\u001bc', 24)).toBe('a b c');
    expect(sanitizeStatusText('\u0000x\u007fy', 24)).toBe('x y');
  });

  it('clamps long text to max code points with a trailing ellipsis', () => {
    expect(sanitizeStatusText('a'.repeat(30), 24)).toBe(`${'a'.repeat(23)}…`);
    expect([...sanitizeStatusText('a'.repeat(30), 24)]).toHaveLength(24);
  });

  it('leaves text at the limit untouched', () => {
    expect(sanitizeStatusText('a'.repeat(24), 24)).toBe('a'.repeat(24));
  });

  it('clamps before escaping — a ## pair is never split by the clamp', () => {
    // 23 hashes kept, each doubled to 46, plus the ellipsis; escape-then-clamp
    // would cut through a doubled pair and leave a dangling '#'
    expect(sanitizeStatusText('#'.repeat(30), 24)).toBe(`${'#'.repeat(46)}…`);
  });

  it('clamps before escaping — a %% pair is never split by the clamp', () => {
    expect(sanitizeStatusText('%'.repeat(30), 24)).toBe(`${'%'.repeat(46)}…`);
  });
});
