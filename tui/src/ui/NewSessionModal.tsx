import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HarnessId, HarnessInfo } from '../types';
import type { CwdCandidate } from './cwd-candidates';
import { fuzzyMatch } from './fuzzy';
import { ACCENT } from './theme';

const BOLD = createTextAttributes({ bold: true });
const DIM = createTextAttributes({ dim: true });

const WIDTH = 50;
const MAX_ROWS = 9;

export type SpawnResult = { ok: true } | { ok: false; error: string };

export interface NewSessionModalProps {
  harnesses: HarnessInfo[];
  candidates: CwdCandidate[];
  /** App sends {cmd:'new'} and closes the modal on ok; ok:false keeps it open. */
  onSubmit: (harness: HarnessId, cwd: string) => Promise<SpawnResult>;
  onCancel: () => void;
  /** existence check for free-text paths (tests inject a fake) */
  isDirectory?: (path: string) => boolean;
}

function realIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The daemon passes cwd to tmux verbatim (no shell), so `~` and relative
 * paths must be resolved here, against the TUI's own cwd.
 */
function resolveFreePath(input: string): string {
  if (input === '~') return homedir();
  if (input.startsWith('~/')) return resolve(homedir(), input.slice(2));
  return resolve(input);
}

function digitOf(key: { name: string; sequence: string }): number | null {
  if (/^[1-9]$/.test(key.name)) return Number(key.name);
  if (/^[1-9]$/.test(key.sequence)) return Number(key.sequence);
  return null;
}

function nextConfigured(
  harnesses: HarnessInfo[],
  from: number,
  delta: number,
): number {
  let i = from;
  while (true) {
    i += delta;
    if (i < 0 || i >= harnesses.length) return from; // no wrap
    if (harnesses[i]?.configured) return i;
  }
}

function firstConfigured(harnesses: HarnessInfo[]): number {
  const i = harnesses.findIndex((h) => h.configured);
  return i === -1 ? 0 : i;
}

export function NewSessionModal({
  harnesses,
  candidates,
  onSubmit,
  onCancel,
  isDirectory = realIsDirectory,
}: NewSessionModalProps) {
  const dims = useTerminalDimensions();
  const [step, setStep] = useState<1 | 2>(1);
  const [harnessIdx, setHarnessIdx] = useState(() =>
    firstConfigured(harnesses),
  );
  const [harness, setHarness] = useState<HarnessId | null>(null);
  const [filter, setFilter] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [freeMode, setFreeMode] = useState(false);
  const [freePath, setFreePath] = useState('');
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      candidates.filter(
        (c) => fuzzyMatch(filter, c.path) || fuzzyMatch(filter, c.label),
      ),
    [candidates, filter],
  );
  const hi =
    filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1);
  // Derived scroll offset — the rendered window follows the highlight so the
  // '›' marker can never sit below the visible rows.
  const offset = Math.max(0, hi - MAX_ROWS + 1);

  // Keyboard handlers fire between commits — read the latest committed values
  // through a ref so back-to-back keys never act on stale state.
  const live = useRef({
    step,
    harnessIdx,
    harness,
    freeMode,
    freePath,
    filtered,
    hi,
  });
  useEffect(() => {
    live.current = {
      step,
      harnessIdx,
      harness,
      freeMode,
      freePath,
      filtered,
      hi,
    };
  });

  // In-flight guard: a double-tapped enter must not spawn two sessions. A ref
  // (not state) so the second keypress sees it before the next commit; cleared
  // only on failure — on success App closes the modal.
  const submitting = useRef(false);

  const pick = (idx: number) => {
    const h = harnesses[idx];
    if (!h?.configured) return;
    setHarnessIdx(idx);
    setHarness(h.id);
    setStep(2);
    setFilter('');
    setFreePath('');
    setHighlight(0);
    setFreeMode(false);
    setError(null);
  };

  const submit = (cwd: string) => {
    const h = live.current.harness;
    if (h === null || cwd === '' || submitting.current) return;
    submitting.current = true;
    setError(null);
    void onSubmit(h, cwd).then((result) => {
      if (!result.ok) {
        submitting.current = false;
        setError(result.error);
      }
    });
  };

  useKeyboard((key) => {
    const l = live.current;
    if (l.step === 1) {
      if (key.name === 'escape') {
        onCancel();
        return;
      }
      const digit = digitOf(key);
      if (digit !== null) {
        pick(digit - 1);
        return;
      }
      if (key.name === 'j' || key.name === 'down') {
        setHarnessIdx(nextConfigured(harnesses, l.harnessIdx, 1));
        return;
      }
      if (key.name === 'k' || key.name === 'up') {
        setHarnessIdx(nextConfigured(harnesses, l.harnessIdx, -1));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        pick(l.harnessIdx);
      }
      return;
    }
    // Step 2 — a focused input owns plain characters; we intercept only
    // navigation/control keys and preventDefault so the input ignores them.
    if (key.name === 'escape') {
      key.preventDefault();
      setStep(1);
      setError(null);
      return;
    }
    if (key.name === 'tab') {
      key.preventDefault();
      setFreeMode((m) => !m);
      setFilter('');
      setFreePath('');
      setHighlight(0);
      return;
    }
    if (key.name === 'return' || key.name === 'enter') {
      key.preventDefault();
      if (submitting.current) return;
      if (l.freeMode) {
        const raw = l.freePath.trim();
        if (raw === '') return;
        const path = resolveFreePath(raw);
        if (!isDirectory(path)) {
          setError(`no such directory: ${path}`);
          return;
        }
        submit(path);
      } else {
        const candidate = l.filtered[l.hi];
        if (candidate) submit(candidate.path);
      }
      return;
    }
    if (l.freeMode) return;
    if (key.name === 'down') {
      key.preventDefault();
      setHighlight(Math.min(l.hi + 1, Math.max(0, l.filtered.length - 1)));
      return;
    }
    if (key.name === 'up') {
      key.preventDefault();
      setHighlight(Math.max(0, l.hi - 1));
    }
  });

  const left = Math.max(0, Math.floor((dims.width - WIDTH) / 2));
  const top = Math.max(0, Math.floor(dims.height / 4));

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={WIDTH}
      zIndex={100}
      border
      borderStyle="rounded"
      backgroundColor="#1e1e2e"
      flexDirection="column"
      padding={1}
    >
      {step === 1 ? (
        <>
          <text>
            <span attributes={BOLD}>New Session</span>
          </text>
          <text> </text>
          {harnesses.map((h, i) => (
            <text key={h.id}>
              <span fg={ACCENT}>{i === harnessIdx ? '› ' : '  '}</span>
              <span attributes={DIM}>[{i + 1}] </span>
              {h.configured ? (
                <>
                  <span attributes={BOLD}>{h.id.padEnd(8)}</span>
                  <span fg="green"> ●</span>
                </>
              ) : (
                <span fg="#777777" attributes={DIM}>
                  {h.id.padEnd(8)} ○ not configured
                </span>
              )}
            </text>
          ))}
          {error !== null ? <text fg="red">{error}</text> : null}
          <text> </text>
          <text>
            <span attributes={DIM}>
              1-{harnesses.length}/j/k: pick esc: cancel
            </span>
          </text>
        </>
      ) : (
        <>
          <text>
            <span attributes={BOLD}>New {harness} session — where?</span>
          </text>
          <text> </text>
          {freeMode ? (
            <box flexDirection="row">
              <text fg="green">{'path: '}</text>
              <input
                focused
                flexGrow={1}
                onInput={setFreePath}
                placeholder="/absolute/or/relative/path"
              />
            </box>
          ) : (
            <>
              <box flexDirection="row">
                <text fg="green">{'> '}</text>
                <input
                  focused
                  flexGrow={1}
                  onInput={setFilter}
                  placeholder="type to filter"
                />
              </box>
              <text> </text>
              {filtered.length === 0 ? (
                <text>
                  <span attributes={DIM}>
                    no matches — tab for free-text path
                  </span>
                </text>
              ) : (
                filtered.slice(offset, offset + MAX_ROWS).map((c, i) => (
                  <text key={c.path}>
                    <span fg={ACCENT}>{offset + i === hi ? '› ' : '  '}</span>
                    <span attributes={offset + i === hi ? BOLD : undefined}>
                      {c.label}
                    </span>
                    {c.annotation !== undefined ? (
                      <span fg="yellow"> {c.annotation}</span>
                    ) : null}
                  </text>
                ))
              )}
            </>
          )}
          {error !== null ? <text fg="red">{error}</text> : null}
          <text> </text>
          <text>
            <span attributes={DIM}>
              {freeMode
                ? 'enter: spawn path esc: back tab: list'
                : '↑/↓: move enter: spawn esc: back tab: path'}
            </span>
          </text>
        </>
      )}
    </box>
  );
}
