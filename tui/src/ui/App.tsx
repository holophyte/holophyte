import { createTextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StatePush } from '../protocol';
import type { HarnessId } from '../types';
import { buildCwdCandidates, scanDevRepos } from './cwd-candidates';
import type { DiffStatRunner } from './diffstat';
import { gitDiffStat } from './diffstat';
import type { Gateway } from './gateway';
import { liveGateway } from './gateway';
import type { SpawnResult } from './NewSessionModal';
import { NewSessionModal } from './NewSessionModal';
import { PreviewPane } from './PreviewPane';
import { QueuePane } from './QueuePane';
import { formatElapsed, SessionsPane, statusLabel } from './SessionsPane';
import { Splash } from './Splash';
import type { DaemonStatus } from './StatusBar';
import { StatusBar } from './StatusBar';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

const SIDEBAR_WIDTH = 30;
const RETRY_MS = 1000;

export interface AppProps {
  gateway?: Gateway;
  onQuit: () => void;
  /** root for the cwd picker's dev-repo scan (tests point this at a tmpdir) */
  devRoot?: string;
  diffStat?: DiffStatRunner;
}

type Focus = 'queue' | 'sessions';

/** Selected id if still present in the list, else the first item (clamp). */
function effectiveId(ids: string[], selectedId: string | null): string | null {
  if (selectedId !== null && ids.includes(selectedId)) return selectedId;
  return ids[0] ?? null;
}

export function App({
  gateway = liveGateway,
  onQuit,
  devRoot,
  diffStat = gitDiffStat,
}: AppProps) {
  const dims = useTerminalDimensions();
  const [push, setPush] = useState<StatePush | null>(null);
  const [daemon, setDaemon] = useState<DaemonStatus>('connecting');
  const [focus, setFocus] = useState<Focus>('queue');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // One-shot: auto-open the picker if the FIRST snapshot says the board is
  // empty. A ref, not state — read/flipped inside the subscription handler;
  // must never re-arm on reconnect, esc, or later sessions-all-exited pushes.
  const autoOpened = useRef(false);

  // Subscription lifecycle — external system: subscribe on mount, retry every
  // second after the connection drops until the daemon is back.
  useEffect(() => {
    let disposed = false;
    let sub: { close(): void } | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const connect = () => {
      if (disposed) return;
      try {
        sub = gateway.subscribe({
          onState: (s) => {
            setPush(s);
            setDaemon('up');
            if (!autoOpened.current) {
              autoOpened.current = true;
              if (s.sessions.length === 0) setModalOpen(true);
            }
          },
          onClose: () => {
            sub = null;
            setDaemon('down');
            retry = setTimeout(connect, RETRY_MS);
          },
        });
      } catch {
        setDaemon('down');
        retry = setTimeout(connect, RETRY_MS);
      }
    };
    connect();
    return () => {
      disposed = true;
      if (retry !== null) clearTimeout(retry);
      sub?.close();
    };
  }, [gateway]);

  // 1s tick so elapsed-in-state displays stay current.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const sessions = push?.sessions ?? [];
  const queue = push?.queue ?? [];
  const runningCount = sessions.filter((s) => s.status === 'running').length;
  const queueIds = queue.map((q) => q.sessionId);
  const sessionIds = sessions.map((s) => s.id);
  const focusedIds = focus === 'queue' ? queueIds : sessionIds;
  const selected = effectiveId(focusedIds, selectedId);
  const previewSession =
    selected !== null
      ? (sessions.find((s) => s.id === selected) ?? null)
      : null;
  const previewReason =
    selected !== null
      ? (queue.find((q) => q.sessionId === selected)?.reason ?? null)
      : null;

  // Keyboard handlers fire between commits — route reads through a ref so
  // they never act on stale state (bramble pattern).
  const live = useRef({ push, focus, selectedId, modalOpen });
  useEffect(() => {
    live.current = { push, focus, selectedId, modalOpen };
  });

  const moveSelection = (delta: number) => {
    const l = live.current;
    if (l.push === null) return;
    const ids =
      l.focus === 'queue'
        ? l.push.queue.map((q) => q.sessionId)
        : l.push.sessions.map((s) => s.id);
    const current = effectiveId(ids, l.selectedId);
    if (current === null) return;
    const idx = ids.indexOf(current);
    const next = Math.min(ids.length - 1, Math.max(0, idx + delta));
    setSelectedId(ids[next] ?? null);
  };

  useKeyboard((key) => {
    const l = live.current;
    if (l.modalOpen) return; // modal owns the keyboard
    if (key.name === 'q') {
      onQuit();
      return;
    }
    if (key.name === 'n') {
      if (l.push !== null) setModalOpen(true);
      return;
    }
    if (key.name === 'tab') {
      setFocus((f) => (f === 'queue' ? 'sessions' : 'queue'));
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
    if (l.push === null) return;
    const ids =
      l.focus === 'queue'
        ? l.push.queue.map((q) => q.sessionId)
        : l.push.sessions.map((s) => s.id);
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

  // Scan the filesystem once per modal open — not on every state push while
  // the picker is up (the scan is synchronous readdir + stat per entry).
  const devRepos = useMemo(
    () => (modalOpen ? scanDevRepos(devRoot) : []),
    [modalOpen, devRoot],
  );
  const candidates = useMemo(
    () =>
      modalOpen
        ? buildCwdCandidates(
            push?.sessions ?? [],
            push?.recentCwds ?? [],
            devRepos,
          )
        : [],
    [modalOpen, push, devRepos],
  );

  const handleSpawn = async (
    harness: HarnessId,
    cwd: string,
  ): Promise<SpawnResult> => {
    try {
      const res = await gateway.request({ cmd: 'new', harness, cwd });
      if (res.ok) {
        setModalOpen(false);
        return { ok: true };
      }
      return { ok: false, error: res.error };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  return (
    <box flexDirection="column" width={dims.width} height={dims.height}>
      {daemon === 'down' ? (
        <box paddingX={1} flexShrink={0}>
          <text fg="yellow">daemon disconnected — retrying…</text>
        </box>
      ) : null}
      <box flexDirection="row" flexGrow={1}>
        <box
          width={SIDEBAR_WIDTH}
          flexShrink={0}
          flexDirection="column"
          border
          borderStyle="single"
          overflow="hidden"
          paddingX={0}
        >
          <SessionsPane
            sessions={sessions}
            selectedId={selected}
            focused={focus === 'sessions'}
            now={now}
          />
          <text> </text>
          <QueuePane
            queue={queue}
            selectedId={selected}
            focused={focus === 'queue'}
            runningCount={runningCount}
          />
          <text> </text>
          <text>
            <span attributes={BOLD}>{'  '}CONTEXT</span>
          </text>
          {previewSession !== null ? (
            <>
              <text>
                <span attributes={DIM}>
                  {'  why  '}
                  {previewReason ?? previewSession.attentionReason ?? '—'}
                </span>
              </text>
              <text>
                <span attributes={DIM}>
                  {'  what '}
                  {previewSession.id} · {statusLabel(previewSession.status)}
                </span>
              </text>
              <text>
                <span attributes={DIM}>
                  {'  upd  '}
                  {formatElapsed(now - previewSession.statusSince)} ago
                </span>
              </text>
            </>
          ) : (
            <text>
              <span attributes={DIM}>{'  —'}</span>
            </text>
          )}
        </box>
        <box
          flexGrow={1}
          flexDirection="column"
          border
          borderStyle="single"
          overflow="hidden"
        >
          {push === null ? (
            <Splash mode="connecting" />
          ) : sessions.length === 0 ? (
            <Splash mode="empty" />
          ) : (
            <PreviewPane
              session={previewSession}
              reason={previewReason}
              runningCount={runningCount}
              diffStat={diffStat}
              now={now}
            />
          )}
        </box>
      </box>
      <StatusBar daemon={daemon} />
      {modalOpen && push !== null ? (
        <NewSessionModal
          harnesses={push.harnesses}
          candidates={candidates}
          onSubmit={handleSpawn}
          onCancel={() => setModalOpen(false)}
        />
      ) : null}
    </box>
  );
}
