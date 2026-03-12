import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useSyncExternalStore } from 'react';

const STALE_THRESHOLD_MS = 30_000;
const OFFLINE_THRESHOLD_MS = 5 * 60_000;
const TICK_INTERVAL_MS = 5_000;

export type CompanionState = 'loading' | 'connected' | 'stale' | 'offline';

function deriveState(
  lastSeen: number | undefined | null,
  now: number,
): CompanionState {
  if (lastSeen == null) return 'offline';
  const age = now - lastSeen;
  if (age < STALE_THRESHOLD_MS) return 'connected';
  if (age < OFFLINE_THRESHOLD_MS) return 'stale';
  return 'offline';
}

// Shared 5-second clock — a single interval serves all useCompanionStatus consumers.
let now = Date.now();
let intervalId: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  if (listeners.size === 0) {
    now = Date.now();
    intervalId = setInterval(() => {
      now = Date.now();
      for (const fn of listeners) fn();
    }, TICK_INTERVAL_MS);
  }
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getSnapshot() {
  return now;
}

export function useCompanionStatus() {
  const status = useQuery(api.companion.getStatus);
  const currentTime = useSyncExternalStore(subscribe, getSnapshot);

  // status === undefined means the query hasn't resolved yet
  const state: CompanionState =
    status === undefined
      ? 'loading'
      : deriveState(status?.lastSeen, currentTime);

  return { state, status, companionUrl: status?.url ?? null };
}
