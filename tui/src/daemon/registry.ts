/**
 * Session registry — the daemon's in-memory source of truth. Pure logic:
 * timestamps are injected, no sockets/tmux/timers, so every transition is
 * deterministically testable. Persistence shape is RegistryJSON (see
 * state-file.ts for load/save).
 */

import { randomUUID } from 'node:crypto';
import type { SessionEvent } from '../protocol';
import type { HarnessId, Session, SessionStatus } from '../types';

export interface RegistryJSON {
  sessions: Session[];
  /** per-harness id counters — never reused, survive restarts */
  counters: Record<string, number>;
  /** most-recent-first spawn targets, deduped, capped */
  recentCwds: string[];
}

const MAX_RECENT_CWDS = 10;

// Hook stamps come from independent processes on a steppable wall clock.
// Ordering only needs to disambiguate sub-second hook races; a strict guard
// would silently freeze event acceptance for the duration of a macOS clock
// step. 2s tolerates the step while still catching genuinely stale events.
const SKEW_MS = 2000;

export class SessionRegistry {
  private sessions = new Map<string, Session>();
  private counters: Record<string, number> = {};
  private cwds: string[] = [];
  /** per-session stale guard — events more than SKEW_MS behind lastEventTs are rejected */
  private lastEventTs = new Map<string, number>();
  /** sessionId → tool whose permission degraded to the in-pane dialog while another was held */
  private paneDialogs = new Map<string, string>();

  static fromJSON(data: RegistryJSON): SessionRegistry {
    const registry = new SessionRegistry();
    for (const persisted of data.sessions) {
      const session: Session = { ...persisted };
      if (session.tmuxWindow === '') {
        // Half-created sessions don't survive a daemon restart — no spawn
        // can be in flight at restore time, and reconcile() never sweeps an
        // empty window id, so restoring one would leave a phantom forever.
        continue;
      }
      if (session.status === 'permission') {
        // Held permission connections don't survive a daemon restart — the
        // agent-side hook fell through to the in-pane dialog.
        session.status = 'needs_input';
        session.attentionReason = 'permission prompt in pane';
        session.pendingPermission = undefined;
      }
      registry.sessions.set(session.id, session);
    }
    registry.counters = { ...data.counters };
    registry.cwds = data.recentCwds.slice(0, MAX_RECENT_CWDS);
    return registry;
  }

  toJSON(): RegistryJSON {
    return {
      sessions: this.all().map((session) => ({ ...session })),
      counters: { ...this.counters },
      recentCwds: [...this.cwds],
    };
  }

  createSession(harness: HarnessId, cwd: string, now: number): Session {
    const n = (this.counters[harness] ?? 0) + 1;
    this.counters[harness] = n;
    const session: Session = {
      id: `${harness}-${n}`,
      harness,
      cwd,
      tmuxWindow: '', // caller assigns via setTmuxWindow after spawning
      status: 'idle',
      // 'ready' (SessionStart hook) flips this to 'awaiting first prompt' —
      // the observable signal that the harness booted and hooks are live.
      attentionReason: 'starting…',
      createdAt: now,
      statusSince: now,
      harnessSessionId: randomUUID(),
    };
    this.sessions.set(session.id, session);
    this.touchCwd(cwd);
    return session;
  }

  setTmuxWindow(id: string, windowId: string): void {
    const session = this.sessions.get(id);
    if (session) session.tmuxWindow = windowId;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  all(): Session[] {
    return [...this.sessions.values()].sort(
      (a, b) => a.createdAt - b.createdAt || compareIds(a.id, b.id),
    );
  }

  recentCwds(): string[] {
    return [...this.cwds];
  }

  /** Apply a lifecycle event. Returns whether visible state changed. */
  applyEvent(id: string, event: SessionEvent, ts: number): boolean {
    const session = this.sessions.get(id);
    if (!session || !this.acceptEvent(session, ts)) return false;

    // A held permission connection owns the next transition: only exit/error
    // may move the session out of 'permission' via events. Masked events
    // still advanced lastEventTs above.
    if (
      session.status === 'permission' &&
      event.kind !== 'exit' &&
      event.kind !== 'error'
    ) {
      return false;
    }

    // An event that applies past the mask means the pane is delivering hooks
    // again — an outstanding in-pane dialog can't still be blocking it.
    this.paneDialogs.delete(id);

    switch (event.kind) {
      case 'ready':
        return this.transition(session, 'idle', 'awaiting first prompt', ts);
      case 'prompt':
      case 'tool':
        return this.transition(session, 'running', undefined, ts);
      case 'question':
        return this.transition(session, 'needs_input', event.text, ts);
      case 'notification':
        return this.transition(session, 'needs_input', event.reason, ts);
      case 'stop': {
        let changed = this.transition(
          session,
          'idle',
          'review / next prompt',
          ts,
        );
        if (
          event.lastMessage !== undefined &&
          session.lastMessage !== event.lastMessage
        ) {
          session.lastMessage = event.lastMessage;
          changed = true;
        }
        return changed;
      }
      case 'exit':
        return this.terminate(session, 'exited', event.reason, ts);
      case 'error':
        return this.terminate(session, 'error', event.reason, ts);
    }
  }

  /** Hold a permission request. Stale-guarded like applyEvent. */
  beginPermission(
    id: string,
    tool: string,
    input: unknown,
    respondBy: number,
    ts: number,
  ): boolean {
    const session = this.sessions.get(id);
    if (!session || !this.acceptEvent(session, ts)) return false;
    this.transition(session, 'permission', `approve: ${tool}`, ts);
    session.pendingPermission = { tool, input, respondBy };
    return true;
  }

  /**
   * A second permission arrived while another was already held: its hook got
   * 'timeout' and degraded to the in-pane dialog. Recorded so resolving the
   * held permission lands on needs_input — the pane is blocked on that dialog
   * and no further hooks fire until it's answered. Cleared by the next
   * applied lifecycle event. Stale-guarded like applyEvent.
   */
  notePaneDialog(id: string, tool: string, ts: number): boolean {
    const session = this.sessions.get(id);
    if (!session || !this.acceptEvent(session, ts)) return false;
    this.paneDialogs.set(id, tool);
    return true;
  }

  /** Resolve a held permission. Only valid while status === 'permission'. */
  resolvePermission(
    id: string,
    outcome: 'allow' | 'deny' | 'timeout',
    now: number,
  ): boolean {
    const session = this.sessions.get(id);
    if (!session || session.status !== 'permission') return false;
    const tool = session.pendingPermission?.tool ?? 'unknown';
    session.pendingPermission = undefined;
    const paneTool = this.paneDialogs.get(id);
    if (paneTool !== undefined) {
      // Another tool's dialog is blocking the pane — whatever this outcome,
      // the session needs eyes, not 'running'.
      this.transition(
        session,
        'needs_input',
        `permission prompt in pane: ${paneTool}`,
        now,
      );
    } else if (outcome === 'timeout') {
      // The agent-side hook fell through to the in-pane dialog.
      this.transition(
        session,
        'needs_input',
        `permission prompt in pane: ${tool}`,
        now,
      );
    } else {
      // allow/deny — the agent proceeds either way; deny makes it report back.
      this.transition(session, 'running', undefined, now);
    }
    return true;
  }

  /** Mark sessions whose tmux window vanished as exited. */
  reconcile(liveWindowIds: string[], now: number): boolean {
    const live = new Set(liveWindowIds);
    let changed = false;
    for (const session of this.sessions.values()) {
      if (session.status === 'exited') continue;
      if (session.tmuxWindow === '' || live.has(session.tmuxWindow)) continue;
      this.terminate(session, 'exited', 'window closed', now);
      changed = true;
    }
    return changed;
  }

  /** Drop exited sessions older than the grace period. */
  pruneExited(now: number, graceMs = 60_000): boolean {
    let changed = false;
    for (const [id, session] of this.sessions) {
      if (session.status === 'exited' && session.statusSince < now - graceMs) {
        this.sessions.delete(id);
        this.lastEventTs.delete(id);
        this.paneDialogs.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Shared stale/terminal guard. Events more than SKEW_MS behind the last
   * accepted event are rejected; accepted events (session not exited) update
   * lastEventTs — including events later masked by a held permission.
   */
  private acceptEvent(session: Session, ts: number): boolean {
    const last = this.lastEventTs.get(session.id);
    if (last !== undefined && ts < last - SKEW_MS) return false;
    if (session.status === 'exited') return false; // nothing revives an exited session
    this.lastEventTs.set(session.id, ts);
    return true;
  }

  /** statusSince updates ONLY when the status value actually changes. */
  private transition(
    session: Session,
    status: SessionStatus,
    attentionReason: string | undefined,
    ts: number,
  ): boolean {
    let changed = false;
    if (session.status !== status) {
      session.status = status;
      session.statusSince = ts;
      changed = true;
    }
    if (session.attentionReason !== attentionReason) {
      session.attentionReason = attentionReason;
      changed = true;
    }
    return changed;
  }

  private terminate(
    session: Session,
    status: SessionStatus,
    reason: string | undefined,
    ts: number,
  ): boolean {
    let changed = this.transition(session, status, reason, ts);
    if (session.pendingPermission !== undefined) {
      session.pendingPermission = undefined;
      changed = true;
    }
    return changed;
  }

  private touchCwd(cwd: string): void {
    this.cwds = [cwd, ...this.cwds.filter((c) => c !== cwd)].slice(
      0,
      MAX_RECENT_CWDS,
    );
  }
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
