/**
 * Socket protocol — newline-delimited JSON over the daemon's Unix socket.
 *
 * Two client kinds:
 * - request/response (hooks, CLI): write one Request line, read one Response
 *   line. Hook calls must complete in <50ms on the daemon side (write + ack);
 *   never block the agent.
 * - subscription (TUI): `{cmd:"subscribe"}` → daemon immediately sends a full
 *   StatePush snapshot (no ok-envelope), then another on every change. No
 *   polling.
 *
 * Exception: `{cmd:"permission"}` is a HELD connection — the hook process
 * stays connected until respondPermission arrives or `timeoutMs` elapses,
 * then receives its Response and exits with it.
 */

import type { HarnessId, Session, StateSnapshot } from './types';

/**
 * Harness-agnostic lifecycle events. Hook adapters translate harness-native
 * hooks (Claude hooks, Codex notify) into these before they reach the daemon.
 *
 * State transitions (see spec.md "State detection"):
 * - ready         → idle ("awaiting first prompt" — harness booted, hooks live)
 * - prompt        → running
 * - tool          → running (clears needs_input)
 * - question      → needs_input (with question text)
 * - notification  → needs_input (carries reason)
 * - stop          → idle (work complete — review/next-prompt item)
 * - exit          → exited + cleanup (covers Ctrl+C where stop never fires)
 * - error         → error
 */
export type SessionEvent =
  | { kind: 'ready' }
  | { kind: 'prompt' }
  | { kind: 'tool' }
  | { kind: 'question'; text: string }
  | { kind: 'notification'; reason: string }
  | { kind: 'stop'; lastMessage?: string }
  | { kind: 'exit'; reason?: string }
  | { kind: 'error'; reason: string };

export type Request =
  /** lifecycle event from a hook adapter. `ts` = emit time (epoch ms) for stale-event guards */
  | { cmd: 'hook'; sessionId: string; event: SessionEvent; ts: number }
  /** synchronous permission request — connection HELD until decision or timeout */
  | {
      cmd: 'permission';
      sessionId: string;
      tool: string;
      input: unknown;
      timeoutMs: number;
      ts: number;
    }
  | { cmd: 'ls' }
  | { cmd: 'new'; harness: HarnessId; cwd: string }
  /** jump to top queue item's tmux window — an empty queue replies plain `{ok:true}` (no session); `ok:false` means a real failure */
  | { cmd: 'next' }
  /** jump to a specific session's tmux window */
  | { cmd: 'jump'; sessionId: string }
  | { cmd: 'respondPermission'; sessionId: string; allow: boolean }
  | { cmd: 'subscribe' }
  | { cmd: 'ping' }
  /** graceful daemon shutdown (tests/dev) — sessions keep running in tmux */
  | { cmd: 'shutdown' };

export type Response =
  /** plain ack — also `next`'s benign "queue is empty" reply */
  | { ok: true }
  | { ok: true; state: StateSnapshot }
  | { ok: true; session: Session }
  | { ok: true; decision: PermissionDecision }
  | { ok: false; error: string };

export type PermissionDecision = 'allow' | 'deny' | 'timeout';

/** pushed to subscribers on every state change */
export interface StatePush extends StateSnapshot {
  type: 'state';
}

export function isStatePush(value: unknown): value is StatePush {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'state'
  );
}
