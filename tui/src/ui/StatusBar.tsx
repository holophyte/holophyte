import { createTextAttributes } from '@opentui/core';

const DIM = createTextAttributes({ dim: true });

export type DaemonStatus = 'connecting' | 'up' | 'down';

export interface StatusBarProps {
  daemon: DaemonStatus;
}

export function StatusBar({ daemon }: StatusBarProps) {
  return (
    <box
      flexDirection="row"
      justifyContent="space-between"
      paddingX={1}
      flexShrink={0}
    >
      <text>
        <span attributes={DIM}>
          n:new enter:open j/k:nav a:approve d:deny r:resume tab:focus q:quit
        </span>
      </text>
      <text>
        {daemon === 'up' ? (
          <span fg="green">daemon ●</span>
        ) : daemon === 'connecting' ? (
          <span fg="yellow">daemon … connecting</span>
        ) : (
          <span fg="red">daemon ○ disconnected</span>
        )}
      </text>
    </box>
  );
}
