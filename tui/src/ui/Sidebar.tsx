/**
 * Per-agent-window sidebar pane (`holo sidebar`). A 30-col read-mostly board:
 * SESSIONS (informational) + QUEUE (navigable). Subscribes to the daemon via
 * the shared useDaemonState hook and self-heals across daemon restarts. Keys
 * fire only when the user deliberately tmux-focuses this pane.
 */

import { createTextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import type { Gateway } from './gateway';
import { liveGateway } from './gateway';
import { QueuePane } from './QueuePane';
import { SessionsPane } from './SessionsPane';
import { effectiveId } from './selection';
import { ACCENT } from './theme';
import { useDaemonState } from './useDaemonState';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

export interface SidebarProps {
  gateway?: Gateway;
  onQuit: () => void;
  /** session whose window this sidebar lives in — shown in the header */
  sessionId?: string;
}

export function Sidebar({
  gateway = liveGateway,
  onQuit,
  sessionId,
}: SidebarProps) {
  const dims = useTerminalDimensions();
  const { push, daemon, now } = useDaemonState(gateway);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const sessions = push?.sessions ?? [];
  const queue = push?.queue ?? [];
  const runningCount = sessions.filter((s) => s.status === 'running').length;
  const queueIds = queue.map((q) => q.sessionId);
  const selected = effectiveId(queueIds, selectedId);

  // Keyboard handlers fire between commits — route reads through a ref so they
  // never act on stale state (bramble pattern, same as App).
  const live = useRef({ push, selectedId });
  useEffect(() => {
    live.current = { push, selectedId };
  });

  const moveSelection = (delta: number) => {
    const l = live.current;
    if (l.push === null) return;
    const ids = l.push.queue.map((q) => q.sessionId);
    const current = effectiveId(ids, l.selectedId);
    if (current === null) return;
    const idx = ids.indexOf(current);
    const next = Math.min(ids.length - 1, Math.max(0, idx + delta));
    setSelectedId(ids[next] ?? null);
  };

  useKeyboard((key) => {
    if (key.name === 'q') {
      onQuit();
      return;
    }
    if (key.name === 'j' || key.name === 'down') {
      moveSelection(1);
      return;
    }
    if (key.name === 'k' || key.name === 'up') {
      moveSelection(-1);
      return;
    }
    const l = live.current;
    if (l.push === null) return;
    const ids = l.push.queue.map((q) => q.sessionId);
    const id = effectiveId(ids, l.selectedId);
    if (id === null) return;
    if (key.name === 'return' || key.name === 'enter') {
      void gateway.request({ cmd: 'jump', sessionId: id }).catch(() => {});
      return;
    }
    if (key.name === 'a' || key.name === 'd') {
      const session = l.push.sessions.find((s) => s.id === id);
      if (session?.pendingPermission === undefined) return;
      void gateway
        .request({
          cmd: 'respondPermission',
          sessionId: id,
          allow: key.name === 'a',
        })
        .catch(() => {});
    }
  });

  return (
    <box flexDirection="column" width={dims.width} height={dims.height}>
      <text>
        <span fg={ACCENT} attributes={BOLD}>
          holo
        </span>
        {sessionId !== undefined ? (
          <span attributes={DIM}> · {sessionId}</span>
        ) : null}
      </text>
      <SessionsPane
        sessions={sessions}
        selectedId={null}
        focused={false}
        now={now}
        emptyHint="none"
      />
      <text> </text>
      <QueuePane
        queue={queue}
        selectedId={selected}
        focused
        runningCount={runningCount}
      />
      <box flexGrow={1} />
      <text>
        <span attributes={DIM}>↵ jump a/d </span>
        {daemon === 'up' ? (
          <span fg="green">●</span>
        ) : daemon === 'connecting' ? (
          <span fg="yellow">…</span>
        ) : (
          <span fg="red">○ retrying</span>
        )}
      </text>
    </box>
  );
}
