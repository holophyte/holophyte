import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import type { RegistryJSON } from './registry';
import { EXITED_GRACE_MS, SessionRegistry } from './registry';

const T0 = 1_000_000;

function setup(now = T0) {
  const registry = new SessionRegistry();
  const session = registry.createSession('claude', '/repo/a', now);
  return { registry, session };
}

describe('createSession', () => {
  it('initializes a session as starting (ready flips it to awaiting first prompt)', () => {
    const { session } = setup();
    expect(session.id).toBe('claude-1');
    expect(session.harness).toBe('claude');
    expect(session.cwd).toBe('/repo/a');
    expect(session.tmuxWindow).toBe('');
    expect(session.status).toBe('idle');
    expect(session.attentionReason).toBe('starting…');
    expect(session.createdAt).toBe(T0);
    expect(session.statusSince).toBe(T0);
    expect(session.pendingPermission).toBeUndefined();
    expect(session.lastMessage).toBeUndefined();
  });

  it('createSession leaves harnessSessionId unset (capture-only)', () => {
    const registry = new SessionRegistry();
    const claude = registry.createSession('claude', '/a', T0);
    const codex = registry.createSession('codex', '/a', T0);
    expect(claude.harnessSessionId).toBeUndefined();
    expect(codex.harnessSessionId).toBeUndefined();
  });

  it('numbers ids per harness independently', () => {
    const registry = new SessionRegistry();
    expect(registry.createSession('claude', '/a', T0).id).toBe('claude-1');
    expect(registry.createSession('claude', '/a', T0).id).toBe('claude-2');
    expect(registry.createSession('codex', '/a', T0).id).toBe('codex-1');
  });

  it('never reuses ids after pruning', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'exit' }, T0 + 1);
    registry.pruneExited(T0 + EXITED_GRACE_MS + 2);
    expect(registry.get('claude-1')).toBeUndefined();
    expect(registry.createSession('claude', '/a', T0).id).toBe('claude-2');
  });
});

describe('recentCwds', () => {
  it('keeps most-recent-first and dedupes', () => {
    const registry = new SessionRegistry();
    registry.createSession('claude', '/a', T0);
    registry.createSession('claude', '/b', T0);
    registry.createSession('claude', '/a', T0);
    expect(registry.recentCwds()).toEqual(['/a', '/b']);
  });

  it('caps at 10 entries', () => {
    const registry = new SessionRegistry();
    for (let i = 1; i <= 12; i++) {
      registry.createSession('claude', `/repo-${i}`, T0);
    }
    const cwds = registry.recentCwds();
    expect(cwds).toHaveLength(10);
    expect(cwds[0]).toBe('/repo-12');
    expect(cwds[9]).toBe('/repo-3');
  });
});

describe('get / all / setTmuxWindow', () => {
  it('get returns the session or undefined', () => {
    const { registry, session } = setup();
    expect(registry.get(session.id)?.id).toBe('claude-1');
    expect(registry.get('nope')).toBeUndefined();
  });

  it('all sorts by createdAt asc with id asc tie-break', () => {
    const registry = new SessionRegistry();
    registry.createSession('codex', '/a', T0 + 100); // codex-1
    registry.createSession('claude', '/a', T0); // claude-1
    registry.createSession('claude', '/a', T0 + 100); // claude-2 ties with codex-1
    expect(registry.all().map((s) => s.id)).toEqual([
      'claude-1',
      'claude-2',
      'codex-1',
    ]);
  });

  it('setTmuxWindow sets the window id and ignores unknown sessions', () => {
    const { registry, session } = setup();
    registry.setTmuxWindow(session.id, '@7');
    expect(registry.get(session.id)?.tmuxWindow).toBe('@7');
    expect(() => registry.setTmuxWindow('nope', '@9')).not.toThrow();
  });
});

describe('applyEvent transitions', () => {
  it('ready → idle awaiting first prompt', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 1);
    expect(registry.applyEvent(session.id, { kind: 'ready' }, T0 + 2)).toBe(
      true,
    );
    expect(session.status).toBe('idle');
    expect(session.attentionReason).toBe('awaiting first prompt');
    expect(session.statusSince).toBe(T0 + 2);
  });

  it('prompt → running and clears attentionReason', () => {
    const { registry, session } = setup();
    expect(registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 1)).toBe(
      true,
    );
    expect(session.status).toBe('running');
    expect(session.attentionReason).toBeUndefined();
    expect(session.statusSince).toBe(T0 + 1);
  });

  it('tool → running and clears attentionReason', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'notification', reason: 'waiting' },
      T0 + 1,
    );
    expect(registry.applyEvent(session.id, { kind: 'tool' }, T0 + 2)).toBe(
      true,
    );
    expect(session.status).toBe('running');
    expect(session.attentionReason).toBeUndefined();
  });

  it('question → needs_input with the question text', () => {
    const { registry, session } = setup();
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'question', text: 'Pick a name' },
        T0 + 1,
      ),
    ).toBe(true);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('Pick a name');
  });

  it('notification → needs_input with the reason', () => {
    const { registry, session } = setup();
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'notification', reason: 'needs approval' },
        T0 + 1,
      ),
    ).toBe(true);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('needs approval');
  });

  it('stop → idle review item and records lastMessage', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 1);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'stop', lastMessage: 'All done' },
        T0 + 2,
      ),
    ).toBe(true);
    expect(session.status).toBe('idle');
    expect(session.attentionReason).toBe('review / next prompt');
    expect(session.lastMessage).toBe('All done');
  });

  it('stop without lastMessage keeps the existing one', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'stop', lastMessage: 'First' },
      T0 + 1,
    );
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 2);
    registry.applyEvent(session.id, { kind: 'stop' }, T0 + 3);
    expect(session.lastMessage).toBe('First');
  });

  it('exit → exited with reason', () => {
    const { registry, session } = setup();
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'exit', reason: 'logout' },
        T0 + 1,
      ),
    ).toBe(true);
    expect(session.status).toBe('exited');
    expect(session.attentionReason).toBe('logout');
  });

  it('error → error with reason', () => {
    const { registry, session } = setup();
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'error', reason: 'crashed' },
        T0 + 1,
      ),
    ).toBe(true);
    expect(session.status).toBe('error');
    expect(session.attentionReason).toBe('crashed');
  });

  it('error is not terminal — a prompt resumes running', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'error', reason: 'crashed' },
      T0 + 1,
    );
    expect(registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 2)).toBe(
      true,
    );
    expect(session.status).toBe('running');
  });

  it('ignores events for unknown sessions', () => {
    const registry = new SessionRegistry();
    expect(registry.applyEvent('ghost-1', { kind: 'prompt' }, T0)).toBe(false);
  });

  it('returns false when nothing changes', () => {
    const { registry, session } = setup();
    // first ready is observable: 'starting…' → 'awaiting first prompt'
    expect(registry.applyEvent(session.id, { kind: 'ready' }, T0 + 1)).toBe(
      true,
    );
    // a repeat ready changes nothing
    expect(registry.applyEvent(session.id, { kind: 'ready' }, T0 + 2)).toBe(
      false,
    );
    expect(session.statusSince).toBe(T0);
  });

  it('updates statusSince only when status actually changes', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'question', text: 'First?' },
      T0 + 1,
    );
    expect(session.statusSince).toBe(T0 + 1);
    // same status, new reason — reason updates, statusSince does not
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'question', text: 'Second?' },
        T0 + 2,
      ),
    ).toBe(true);
    expect(session.attentionReason).toBe('Second?');
    expect(session.statusSince).toBe(T0 + 1);
  });

  it('nothing revives an exited session', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'exit', reason: 'gone' }, T0 + 1);
    for (const event of [
      { kind: 'ready' },
      { kind: 'prompt' },
      { kind: 'tool' },
      { kind: 'question', text: 'q' },
      { kind: 'notification', reason: 'r' },
      { kind: 'stop' },
      { kind: 'exit', reason: 'again' },
      { kind: 'error', reason: 'e' },
    ] as const) {
      expect(registry.applyEvent(session.id, event, T0 + 10)).toBe(false);
    }
    expect(session.status).toBe('exited');
    expect(session.attentionReason).toBe('gone');
  });
});

describe('stale guard', () => {
  it('rejects a stop more than 2s staler than a newer prompt', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    expect(registry.applyEvent(session.id, { kind: 'stop' }, T0 + 2_999)).toBe(
      false,
    );
    expect(session.status).toBe('running');
  });

  it('accepts events with ts equal to lastEventTs', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 100);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'question', text: 'q' },
        T0 + 100,
      ),
    ).toBe(true);
    expect(session.status).toBe('needs_input');
  });

  it('accepts an event stamped 1s backward (bounded clock-step skew)', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'question', text: 'q' },
        T0 + 4_000,
      ),
    ).toBe(true);
    expect(session.status).toBe('needs_input');
  });

  it('stale-guards beginPermission', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    expect(
      registry.beginPermission(session.id, 'Bash', {}, T0 + 9_999, T0 + 2_999),
    ).toBe(false);
    expect(session.status).toBe('running');
    expect(session.pendingPermission).toBeUndefined();
  });

  it('masked events while permission still advance lastEventTs', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 9_999, T0 + 100);
    // masked, but advances lastEventTs to T0+6000
    expect(registry.applyEvent(session.id, { kind: 'stop' }, T0 + 6_000)).toBe(
      false,
    );
    registry.resolvePermission(session.id, 'allow', T0 + 6_100);
    // more than 2s older than the masked event → stale
    expect(
      registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 3_000),
    ).toBe(false);
    expect(session.status).toBe('running');
  });
});

describe('permission lifecycle', () => {
  it('beginPermission holds the session in permission state', () => {
    const { registry, session } = setup();
    expect(
      registry.beginPermission(
        session.id,
        'Bash',
        { command: 'rm -rf x' },
        T0 + 999,
        T0 + 1,
      ),
    ).toBe(true);
    expect(session.status).toBe('permission');
    expect(session.attentionReason).toBe('approve: Bash');
    expect(session.pendingPermission).toEqual({
      tool: 'Bash',
      input: { command: 'rm -rf x' },
      respondBy: T0 + 999,
    });
    expect(session.statusSince).toBe(T0 + 1);
  });

  it('beginPermission is rejected on exited sessions', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'exit' }, T0 + 1);
    expect(
      registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 2),
    ).toBe(false);
    expect(session.status).toBe('exited');
  });

  it('beginPermission ignores unknown sessions', () => {
    const registry = new SessionRegistry();
    expect(registry.beginPermission('ghost-1', 'Bash', {}, T0 + 999, T0)).toBe(
      false,
    );
  });

  it('allow → running, permission and reason cleared', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(registry.resolvePermission(session.id, 'allow', T0 + 5)).toBe(true);
    expect(session.status).toBe('running');
    expect(session.attentionReason).toBeUndefined();
    expect(session.pendingPermission).toBeUndefined();
    expect(session.statusSince).toBe(T0 + 5);
  });

  it('deny → running too (the agent reports back)', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Edit', {}, T0 + 999, T0 + 1);
    expect(registry.resolvePermission(session.id, 'deny', T0 + 5)).toBe(true);
    expect(session.status).toBe('running');
    expect(session.attentionReason).toBeUndefined();
    expect(session.pendingPermission).toBeUndefined();
  });

  it('timeout → needs_input pointing at the in-pane prompt', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(registry.resolvePermission(session.id, 'timeout', T0 + 999)).toBe(
      true,
    );
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('permission prompt in pane: Bash');
    expect(session.pendingPermission).toBeUndefined();
    expect(session.statusSince).toBe(T0 + 999);
  });

  it('resolvePermission is invalid outside permission state', () => {
    const { registry, session } = setup();
    expect(registry.resolvePermission(session.id, 'allow', T0 + 1)).toBe(false);
    expect(registry.resolvePermission('ghost-1', 'allow', T0 + 1)).toBe(false);
    expect(session.status).toBe('idle');
  });

  it('masks ready/prompt/tool/question/notification/stop while permission is held', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    for (const event of [
      { kind: 'ready' },
      { kind: 'prompt' },
      { kind: 'tool' },
      { kind: 'question', text: 'q' },
      { kind: 'notification', reason: 'r' },
      { kind: 'stop', lastMessage: 'm' },
    ] as const) {
      expect(registry.applyEvent(session.id, event, T0 + 2)).toBe(false);
      expect(session.status).toBe('permission');
      expect(session.attentionReason).toBe('approve: Bash');
      expect(session.pendingPermission).toBeDefined();
    }
  });

  it('exit applies from permission and clears pendingPermission', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'exit', reason: 'window closed' },
        T0 + 2,
      ),
    ).toBe(true);
    expect(session.status).toBe('exited');
    expect(session.attentionReason).toBe('window closed');
    expect(session.pendingPermission).toBeUndefined();
  });

  it('error applies from permission and clears pendingPermission', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'error', reason: 'agent crashed' },
        T0 + 2,
      ),
    ).toBe(true);
    expect(session.status).toBe('error');
    expect(session.attentionReason).toBe('agent crashed');
    expect(session.pendingPermission).toBeUndefined();
  });
});

describe('pane-dialog marker (overlapping permissions)', () => {
  function heldWithPaneDialog() {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(registry.notePaneDialog(session.id, 'Edit', T0 + 2)).toBe(true);
    return { registry, session };
  }

  it('allow lands on needs_input naming the pane tool', () => {
    const { registry, session } = heldWithPaneDialog();
    expect(registry.resolvePermission(session.id, 'allow', T0 + 3)).toBe(true);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('permission prompt in pane: Edit');
    expect(session.pendingPermission).toBeUndefined();
  });

  it('deny lands on needs_input too', () => {
    const { registry, session } = heldWithPaneDialog();
    registry.resolvePermission(session.id, 'deny', T0 + 3);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('permission prompt in pane: Edit');
  });

  it('hold timeout names the pane tool, not the held one', () => {
    const { registry, session } = heldWithPaneDialog();
    registry.resolvePermission(session.id, 'timeout', T0 + 999);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('permission prompt in pane: Edit');
  });

  it('a masked notification does not clear the marker', () => {
    const { registry, session } = heldWithPaneDialog();
    // Notification(permission_prompt) fired by the in-pane dialog — masked
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'notification', reason: 'permission prompt' },
        T0 + 3,
      ),
    ).toBe(false);
    registry.resolvePermission(session.id, 'allow', T0 + 4);
    expect(session.attentionReason).toBe('permission prompt in pane: Edit');
  });

  it('an applied lifecycle event clears the marker', () => {
    const { registry, session } = heldWithPaneDialog();
    registry.resolvePermission(session.id, 'allow', T0 + 3);
    expect(registry.applyEvent(session.id, { kind: 'tool' }, T0 + 4)).toBe(
      true,
    );
    expect(session.status).toBe('running');
    // a fresh permission now resolves to running — the marker is gone
    registry.beginPermission(session.id, 'Write', {}, T0 + 999, T0 + 5);
    registry.resolvePermission(session.id, 'allow', T0 + 6);
    expect(session.status).toBe('running');
    expect(session.attentionReason).toBeUndefined();
  });

  it('survives resolution until a lifecycle event arrives — a third permission still lands in-pane', () => {
    const { registry, session } = heldWithPaneDialog();
    registry.resolvePermission(session.id, 'allow', T0 + 3);
    // the unanswered Edit dialog still blocks the pane
    registry.beginPermission(session.id, 'Write', {}, T0 + 999, T0 + 4);
    registry.resolvePermission(session.id, 'allow', T0 + 5);
    expect(session.status).toBe('needs_input');
    expect(session.attentionReason).toBe('permission prompt in pane: Edit');
  });

  it('notePaneDialog is stale-guarded and ignores unknown/exited sessions', () => {
    const registry = new SessionRegistry();
    expect(registry.notePaneDialog('ghost-1', 'Edit', T0)).toBe(false);
    const session = registry.createSession('claude', '/a', T0);
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    expect(registry.notePaneDialog(session.id, 'Edit', T0 + 2_999)).toBe(false);
    registry.applyEvent(session.id, { kind: 'exit' }, T0 + 6_000);
    expect(registry.notePaneDialog(session.id, 'Edit', T0 + 7_000)).toBe(false);
  });
});

describe('fromJSON / toJSON', () => {
  it('round-trips sessions, counters and recentCwds', () => {
    const registry = new SessionRegistry();
    const a = registry.createSession('claude', '/a', T0);
    const b = registry.createSession('codex', '/b', T0 + 1);
    registry.setTmuxWindow(a.id, '@3');
    registry.setTmuxWindow(b.id, '@4');
    registry.applyEvent(a.id, { kind: 'prompt' }, T0 + 2);

    const restored = SessionRegistry.fromJSON(registry.toJSON());
    expect(restored.toJSON()).toEqual(registry.toJSON());
    expect(restored.get('claude-1')?.status).toBe('running');
    expect(restored.recentCwds()).toEqual(['/b', '/a']);
  });

  it('continues id numbering after a restore', () => {
    const registry = new SessionRegistry();
    registry.createSession('claude', '/a', T0);
    registry.createSession('claude', '/a', T0);
    const restored = SessionRegistry.fromJSON(registry.toJSON());
    expect(restored.createSession('claude', '/a', T0).id).toBe('claude-3');
    expect(restored.createSession('codex', '/a', T0).id).toBe('codex-1');
  });

  it('demotes persisted permission sessions to needs_input', () => {
    const registry = new SessionRegistry();
    const session = registry.createSession('claude', '/a', T0);
    registry.setTmuxWindow(session.id, '@2');
    registry.beginPermission(
      session.id,
      'Bash',
      { command: 'ls' },
      T0 + 999,
      T0 + 1,
    );

    const restored = SessionRegistry.fromJSON(registry.toJSON());
    const demoted = restored.get(session.id);
    expect(demoted?.status).toBe('needs_input');
    expect(demoted?.attentionReason).toBe('permission prompt in pane');
    expect(demoted?.pendingPermission).toBeUndefined();
    // statusSince is preserved so aging continues
    expect(demoted?.statusSince).toBe(T0 + 1);
  });

  it('restores running sessions as-is', () => {
    const registry = new SessionRegistry();
    const session = registry.createSession('claude', '/a', T0);
    registry.setTmuxWindow(session.id, '@2');
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 1);
    const restored = SessionRegistry.fromJSON(registry.toJSON());
    expect(restored.get(session.id)?.status).toBe('running');
  });

  it('drops persisted sessions that never got a tmux window', () => {
    const registry = new SessionRegistry();
    const half = registry.createSession('claude', '/a', T0); // tmuxWindow ''
    const spawned = registry.createSession('claude', '/b', T0);
    registry.setTmuxWindow(spawned.id, '@2');

    const restored = SessionRegistry.fromJSON(registry.toJSON());
    expect(restored.get(half.id)).toBeUndefined();
    expect(restored.get(spawned.id)).toBeDefined();
    // dropped sessions never free their id — counters persist independently
    expect(restored.createSession('claude', '/a', T0).id).toBe('claude-3');
  });

  it('resets the stale guard across restarts', () => {
    const registry = new SessionRegistry();
    const session = registry.createSession('claude', '/a', T0);
    registry.setTmuxWindow(session.id, '@2');
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    const restored = SessionRegistry.fromJSON(registry.toJSON());
    // lastEventTs isn't persisted — a >2s-older ts is accepted after restore
    expect(restored.applyEvent(session.id, { kind: 'stop' }, T0 + 100)).toBe(
      true,
    );
  });

  it('caps restored recentCwds at 10', () => {
    const data: RegistryJSON = {
      sessions: [],
      counters: {},
      recentCwds: Array.from({ length: 15 }, (_, i) => `/r${i}`),
    };
    expect(SessionRegistry.fromJSON(data).recentCwds()).toHaveLength(10);
  });
});

describe('reconcile', () => {
  function spawned(registry: SessionRegistry, window: string): Session {
    const session = registry.createSession('claude', '/a', T0);
    registry.setTmuxWindow(session.id, window);
    return session;
  }

  it('exits sessions whose window is gone', () => {
    const registry = new SessionRegistry();
    const dead = spawned(registry, '@2');
    const alive = spawned(registry, '@3');
    expect(registry.reconcile(['@3'], T0 + 100)).toBe(true);
    expect(dead.status).toBe('exited');
    expect(dead.attentionReason).toBe('window closed');
    expect(dead.statusSince).toBe(T0 + 100);
    expect(alive.status).toBe('idle');
  });

  it('clears pendingPermission on window-closed sessions', () => {
    const registry = new SessionRegistry();
    const session = spawned(registry, '@2');
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    registry.reconcile([], T0 + 100);
    expect(session.status).toBe('exited');
    expect(session.pendingPermission).toBeUndefined();
  });

  it('skips sessions without a window and already-exited ones', () => {
    const registry = new SessionRegistry();
    const unspawned = registry.createSession('claude', '/a', T0); // tmuxWindow ''
    const gone = spawned(registry, '@2');
    registry.applyEvent(gone.id, { kind: 'exit', reason: 'done' }, T0 + 1);
    expect(registry.reconcile([], T0 + 100)).toBe(false);
    expect(unspawned.status).toBe('idle');
    expect(gone.attentionReason).toBe('done'); // not overwritten with 'window closed'
  });

  it('returns false when all windows are live', () => {
    const registry = new SessionRegistry();
    spawned(registry, '@2');
    expect(registry.reconcile(['@2'], T0 + 100)).toBe(false);
  });
});

describe('pruneExited', () => {
  it('removes exited sessions past the grace period', () => {
    const registry = new SessionRegistry();
    const session = registry.createSession('claude', '/a', T0);
    registry.applyEvent(session.id, { kind: 'exit' }, T0);
    expect(registry.pruneExited(T0 + EXITED_GRACE_MS + 1)).toBe(true);
    expect(registry.get(session.id)).toBeUndefined();
    expect(registry.all()).toEqual([]);
  });

  it('keeps exited sessions within the grace period', () => {
    const registry = new SessionRegistry();
    const session = registry.createSession('claude', '/a', T0);
    registry.applyEvent(session.id, { kind: 'exit' }, T0);
    expect(registry.pruneExited(T0 + EXITED_GRACE_MS)).toBe(false); // not strictly older
    expect(registry.get(session.id)).toBeDefined();
  });

  it('never removes non-exited sessions and honors custom graceMs', () => {
    const registry = new SessionRegistry();
    const idle = registry.createSession('claude', '/a', T0);
    const gone = registry.createSession('claude', '/a', T0);
    registry.applyEvent(gone.id, { kind: 'exit' }, T0);
    expect(registry.pruneExited(T0 + 11, 10)).toBe(true);
    expect(registry.get(idle.id)).toBeDefined();
    expect(registry.get(gone.id)).toBeUndefined();
  });
});

describe('ready capture', () => {
  it('sets harnessSessionId and returns true even when status did not change', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'ready', harnessSessionId: 'conv-1' },
      T0 + 1,
    );
    expect(session.harnessSessionId).toBe('conv-1');
    // status/reason unchanged — only the new id forces true
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'ready', harnessSessionId: 'conv-2' },
        T0 + 2,
      ),
    ).toBe(true);
  });

  it('overwrites a differing id (in-app /clear and /resume re-fire SessionStart)', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'ready', harnessSessionId: 'conv-1' },
      T0 + 1,
    );
    registry.applyEvent(
      session.id,
      { kind: 'ready', harnessSessionId: 'conv-2' },
      T0 + 2,
    );
    expect(session.harnessSessionId).toBe('conv-2');
  });

  it('a plain ready leaves an existing id untouched', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'ready', harnessSessionId: 'conv-1' },
      T0 + 1,
    );
    expect(registry.applyEvent(session.id, { kind: 'ready' }, T0 + 2)).toBe(
      false,
    );
    expect(session.harnessSessionId).toBe('conv-1');
  });

  it('rejects capture from a stale ready', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'prompt' }, T0 + 5_000);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'ready', harnessSessionId: 'stale-conv' },
        T0 + 2_999,
      ),
    ).toBe(false);
    expect(session.harnessSessionId).toBeUndefined();
  });

  it('skips capture while masked by a held permission', () => {
    const { registry, session } = setup();
    registry.beginPermission(session.id, 'Bash', {}, T0 + 999, T0 + 1);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'ready', harnessSessionId: 'conv-1' },
        T0 + 2,
      ),
    ).toBe(false);
    expect(session.harnessSessionId).toBeUndefined();
  });

  it('rejects capture on exited sessions', () => {
    const { registry, session } = setup();
    registry.applyEvent(session.id, { kind: 'exit' }, T0 + 1);
    expect(
      registry.applyEvent(
        session.id,
        { kind: 'ready', harnessSessionId: 'conv-1' },
        T0 + 10,
      ),
    ).toBe(false);
    expect(session.harnessSessionId).toBeUndefined();
  });

  it('round-trips the captured id through toJSON/fromJSON', () => {
    const { registry, session } = setup();
    registry.setTmuxWindow(session.id, '@2');
    registry.applyEvent(
      session.id,
      { kind: 'ready', harnessSessionId: 'conv-1' },
      T0 + 1,
    );
    const restored = SessionRegistry.fromJSON(registry.toJSON());
    expect(restored.get(session.id)?.harnessSessionId).toBe('conv-1');
  });
});

describe('adoptLineage', () => {
  it('copies harnessSessionId and lastMessage onto an existing session', () => {
    const { registry, session } = setup();
    registry.adoptLineage(session.id, {
      harnessSessionId: 'conv-1',
      lastMessage: 'prior tail',
    });
    expect(session.harnessSessionId).toBe('conv-1');
    expect(session.lastMessage).toBe('prior tail');
  });

  it('leaves an existing lastMessage untouched when lineage omits it', () => {
    const { registry, session } = setup();
    registry.applyEvent(
      session.id,
      { kind: 'stop', lastMessage: 'kept' },
      T0 + 1,
    );
    registry.adoptLineage(session.id, { harnessSessionId: 'conv-1' });
    expect(session.harnessSessionId).toBe('conv-1');
    expect(session.lastMessage).toBe('kept');
  });

  it('is a no-op on unknown ids', () => {
    const registry = new SessionRegistry();
    expect(() =>
      registry.adoptLineage('ghost-1', { harnessSessionId: 'conv-1' }),
    ).not.toThrow();
  });
});

describe('remove', () => {
  it('deletes only the target session', () => {
    const registry = new SessionRegistry();
    const a = registry.createSession('claude', '/a', T0);
    const b = registry.createSession('claude', '/b', T0);
    registry.applyEvent(a.id, { kind: 'exit' }, T0 + 1);
    registry.applyEvent(b.id, { kind: 'exit' }, T0 + 1);
    expect(registry.remove(a.id)).toBe(true);
    expect(registry.get(a.id)).toBeUndefined();
    expect(registry.get(b.id)?.status).toBe('exited');
  });

  it('returns false for unknown ids', () => {
    expect(new SessionRegistry().remove('ghost-1')).toBe(false);
  });

  it('never frees the removed id — counters still advance', () => {
    const { registry, session } = setup();
    registry.remove(session.id);
    expect(registry.createSession('claude', '/a', T0).id).toBe('claude-2');
  });
});
