import { createTextAttributes } from '@opentui/core';
import type { QueueItem } from '../types';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

export interface QueuePaneProps {
  queue: QueueItem[];
  selectedId: string | null;
  focused: boolean;
  runningCount: number;
}

export function QueuePane({ queue, selectedId, focused, runningCount }: QueuePaneProps) {
  return (
    <box flexDirection="column" flexShrink={0} overflow="hidden">
      <text>
        <span attributes={BOLD}>{focused ? '▸ ' : '  '}QUEUE</span>
      </text>
      {queue.length === 0 ? (
        <text>
          <span attributes={DIM}> nothing needs you ({runningCount} running)</span>
        </text>
      ) : (
        queue.map((item, i) => {
          const selected = focused && item.sessionId === selectedId;
          return (
            <box key={item.sessionId} flexDirection="column">
              <text>
                <span>{selected ? '› ' : '  '}</span>
                <span attributes={selected ? BOLD : undefined}>
                  {i + 1}. {item.sessionId}
                </span>
              </text>
              <text>
                <span attributes={DIM}>
                  {'     '}
                  {item.reason}
                </span>
              </text>
            </box>
          );
        })
      )}
    </box>
  );
}
