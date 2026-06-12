/**
 * Pure formatter for the holo tmux session's status-right — no I/O. The
 * daemon pushes the rendered line on every state change so attention counts
 * and the top queue item are visible in every agent window. Segment order is
 * the truncation policy: tmux clips the rendered status-right at the right
 * edge, so the reason tail drops first and the brand + counts survive longest.
 */

import type { QueueItem, Session } from '../types';
import { ACCENT } from '../ui/theme';

const REASON_MAX = 24;

const BRAND = `#[fg=${ACCENT},bold]holo#[default]`;

export const STATUS_STOPPED_LINE = `${BRAND} #[dim]holod stopped#[default]`;

/**
 * Make agent-derived text safe inside a tmux format string: strip control
 * chars, collapse whitespace, clamp, then escape `#` → `##` (neutralizes
 * `#(cmd)` command injection and `#[fg=…]` style injection) and `%` → `%%`
 * (tmux runs status-right through strftime, so a bare `%d` would render the
 * day of month). Escaping AFTER clamping means a `##`/`%%` pair can never be
 * split by the clamp, which would leave a dangling escape that fuses with
 * the next character.
 */
export function sanitizeStatusText(text: string, max: number): string {
  const collapsed = text
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const points = [...collapsed]; // code points, so the clamp never splits a surrogate pair
  const clamped =
    points.length > max ? `${points.slice(0, max - 1).join('')}…` : collapsed;
  return clamped.replaceAll('#', '##').replaceAll('%', '%%');
}

export function renderStatusLine(
  sessions: Session[],
  queue: QueueItem[],
): string {
  const active = sessions.filter((session) => session.status !== 'exited');
  if (active.length === 0) return `${BRAND} #[dim]no sessions#[default]`;

  const count = (status: Session['status']) =>
    active.filter((session) => session.status === status).length;

  const segments = [BRAND];
  const permission = count('permission');
  if (permission > 0) {
    segments.push(`#[fg=yellow,bold]${permission} perm#[default]`);
  }
  const needsInput = count('needs_input');
  if (needsInput > 0) segments.push(`#[fg=yellow]${needsInput} need#[default]`);
  const errored = count('error');
  if (errored > 0) segments.push(`#[fg=red]${errored} err#[default]`);
  const running = count('running');
  const idle = count('idle');
  if (running > 0 || idle > 0) {
    const halves = [];
    if (running > 0) halves.push(`${running} run`);
    if (idle > 0) halves.push(`${idle} idle`);
    segments.push(`#[dim]${halves.join(' ')}#[default]`);
  }

  const pointer = `#[fg=${ACCENT}]▸#[default]`;
  const top = queue[0];
  if (top === undefined) {
    segments.push(`${pointer} #[dim]nothing needs you#[default]`);
  } else {
    // session ids are daemon-generated ("claude-1"); only reasons carry
    // arbitrary agent output and need sanitizing
    segments.push(
      `${pointer} ${top.sessionId} #[dim]${sanitizeStatusText(top.reason, REASON_MAX)}#[default]`,
    );
  }
  return segments.join(' ');
}
