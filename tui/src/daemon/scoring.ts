/**
 * Deterministic queue scoring — see spec.md "Queue".
 *
 *   score = effortWeight + agingBonus + urgencyBonus
 *     effortWeight: permission 100, needs_input 60, error 50, idle 30
 *     agingBonus:   +2 per full minute since statusSince, capped at +40
 *     urgencyBonus: reserved (0 in v1)
 *
 * Only those four statuses are queue-eligible; running/exited never queue.
 * Pure functions with injected `now` — no clocks, no I/O.
 */

import type { QueueItem, Session, SessionStatus } from '../types';

const EFFORT_WEIGHT: Partial<Record<SessionStatus, number>> = {
  permission: 100,
  needs_input: 60,
  error: 50,
  idle: 30,
};

const MS_PER_MINUTE = 60_000;
const AGING_CAP = 40;

/** Ineligible statuses (running/exited) score 0. */
export function scoreSession(session: Session, now: number): number {
  const weight = EFFORT_WEIGHT[session.status];
  if (weight === undefined) return 0;
  const fullMinutes = Math.floor(
    Math.max(0, now - session.statusSince) / MS_PER_MINUTE,
  );
  return weight + Math.min(fullMinutes * 2, AGING_CAP);
}

export function buildQueue(sessions: Session[], now: number): QueueItem[] {
  return sessions
    .filter((session) => EFFORT_WEIGHT[session.status] !== undefined)
    .map((session) => ({ session, score: scoreSession(session, now) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        statusRank(b.session.status) - statusRank(a.session.status) ||
        a.session.statusSince - b.session.statusSince ||
        compareIds(a.session.id, b.session.id),
    )
    .map(({ session, score }) => ({
      sessionId: session.id,
      score,
      reason: queueReason(session),
    }));
}

function queueReason(session: Session): string {
  switch (session.status) {
    case 'permission':
      return session.pendingPermission
        ? `approve: ${session.pendingPermission.tool}`
        : (session.attentionReason ?? 'approve');
    case 'needs_input':
      return session.attentionReason ?? 'needs input';
    case 'idle':
      return session.attentionReason ?? 'review / next prompt';
    case 'error':
      return session.attentionReason ?? 'error';
    default:
      // unreachable — filtered to eligible statuses above
      return session.attentionReason ?? '';
  }
}

// Spec: "permissions jump the queue" — a fresh permission must outrank an
// aged needs_input even when capped aging makes the scores tie at 100.
function statusRank(status: SessionStatus): number {
  return status === 'permission' ? 1 : 0;
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
