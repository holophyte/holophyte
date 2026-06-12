import { createTextAttributes } from '@opentui/core';
import { useEffect, useState } from 'react';
import type { Session } from '../types';
import type { DiffStatRunner } from './diffstat';
import { formatElapsed, statusLabel } from './SessionsPane';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

const MAX_MESSAGE_LINES = 10;
const MAX_DIFF_LINES = 12;
const MAX_INPUT_CHARS = 200;

export interface PreviewPaneProps {
  session: Session | null;
  /** queue reason for the selected item, when it is queued */
  reason: string | null;
  runningCount: number;
  diffStat: DiffStatRunner;
  now: number;
}

export function PreviewPane({
  session,
  reason,
  runningCount,
  diffStat,
  now,
}: PreviewPaneProps) {
  const cwd = session?.cwd;
  const statusSince = session?.statusSince;
  const [diff, setDiff] = useState('');

  // External system (git subprocess) — refetch when the selected cwd changes,
  // and on every status transition (statusSince bumps) so a session that kept
  // editing files doesn't show the diff captured at selection time forever.
  // The `alive` flag guards against out-of-order resolutions: the cleanup for
  // the previous fetch runs before the next effect, so a slow stale fetch can
  // never overwrite the current result.
  // biome-ignore lint/correctness/useExhaustiveDependencies(statusSince): statusSince is a deliberate refetch trigger — it bumps on every status transition even though it is unused in the effect body.
  useEffect(() => {
    if (cwd === undefined) return;
    let alive = true;
    setDiff('');
    diffStat(cwd).then(
      (text) => {
        if (alive) setDiff(text);
      },
      () => {
        if (alive) setDiff('no diff available');
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, diffStat, statusSince]);

  if (!session) {
    return (
      <box flexDirection="column" padding={1} flexGrow={1}>
        <text>All {runningCount} agents running — nothing needs you.</text>
      </box>
    );
  }

  const permission = session.pendingPermission;
  return (
    <box flexDirection="column" padding={1} flexGrow={1} overflow="hidden">
      <text>
        <span attributes={BOLD}>{session.id}</span>
        <span attributes={DIM}> {session.cwd}</span>
      </text>
      <text>
        <span fg="yellow">
          {reason ?? session.attentionReason ?? statusLabel(session.status)}
        </span>
        <span attributes={DIM}>
          {' '}
          · {statusLabel(session.status)}{' '}
          {formatElapsed(now - session.statusSince)}
        </span>
      </text>
      {permission ? (
        <box
          flexDirection="column"
          border
          borderStyle="rounded"
          borderColor="yellow"
          paddingX={1}
          flexShrink={0}
        >
          <text>
            <span attributes={BOLD}>permission: </span>
            <span fg="yellow">{permission.tool}</span>
          </text>
          <text>
            <span attributes={DIM}>
              {String(JSON.stringify(permission.input) ?? '').slice(
                0,
                MAX_INPUT_CHARS,
              )}
            </span>
          </text>
          <text>
            <span fg="green">[a]pprove</span>
            <span>{'  '}</span>
            <span fg="red">[d]eny</span>
          </text>
        </box>
      ) : null}
      {session.lastMessage !== undefined ? (
        <box flexDirection="column" flexShrink={0}>
          <text> </text>
          <text>
            <span attributes={DIM}>last message</span>
          </text>
          {session.lastMessage
            .split('\n')
            .slice(0, MAX_MESSAGE_LINES)
            .map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static line list
              <text key={i}>{line || ' '}</text>
            ))}
        </box>
      ) : null}
      <box flexDirection="column" flexShrink={0}>
        <text> </text>
        <text>
          <span attributes={DIM}>git diff --stat</span>
        </text>
        {(diff || '…')
          .split('\n')
          .slice(0, MAX_DIFF_LINES)
          .map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static line list
            <text key={i}>{line || ' '}</text>
          ))}
      </box>
    </box>
  );
}
