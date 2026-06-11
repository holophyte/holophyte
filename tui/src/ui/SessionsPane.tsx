import { basename } from 'node:path';
import { createTextAttributes } from '@opentui/core';
import type { Session, SessionStatus } from '../types';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

export interface SessionsPaneProps {
  sessions: Session[];
  selectedId: string | null;
  focused: boolean;
  now: number;
}

export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

export function statusLabel(status: SessionStatus): string {
  return status === 'needs_input' ? 'needs input' : status;
}

export function statusDot(status: SessionStatus): string {
  if (status === 'running') return '○';
  if (status === 'exited') return '·';
  return '●';
}

export function statusColor(status: SessionStatus): string {
  switch (status) {
    case 'permission':
    case 'needs_input':
      return 'yellow';
    case 'idle':
      return 'green';
    case 'error':
      return 'red';
    case 'running':
      return 'cyan';
    case 'exited':
      return '#666666';
  }
}

export function SessionsPane({
  sessions,
  selectedId,
  focused,
  now,
}: SessionsPaneProps) {
  return (
    <box flexDirection="column" flexShrink={0} overflow="hidden">
      <text>
        <span attributes={BOLD}>{focused ? '▸ ' : '  '}SESSIONS</span>
      </text>
      {sessions.length === 0 ? (
        <text>
          <span attributes={DIM}> none — n to spawn</span>
        </text>
      ) : (
        sessions.map((session) => {
          const selected = focused && session.id === selectedId;
          return (
            <box key={session.id} flexDirection="column">
              <text>
                <span>{selected ? '›' : ' '}</span>
                <span fg={statusColor(session.status)}>
                  {statusDot(session.status)}{' '}
                </span>
                <span attributes={selected ? BOLD : undefined}>
                  {session.id}
                </span>
                <span attributes={DIM}> {basename(session.cwd)}</span>
              </text>
              <text>
                <span attributes={DIM}>
                  {'   '}
                  {statusLabel(session.status)}{' '}
                  {formatElapsed(now - session.statusSince)}
                </span>
              </text>
            </box>
          );
        })
      )}
    </box>
  );
}
