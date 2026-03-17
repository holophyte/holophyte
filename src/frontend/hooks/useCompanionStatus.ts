import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { useSyncExternalStore } from 'react';

/** Heartbeat age below which the companion is considered connected. */
const STALE_THRESHOLD_MS = 30_000;
/** Heartbeat age above which the companion is considered offline (5 minutes). */
const OFFLINE_THRESHOLD_MS = 5 * 60_000;
/** How often the shared clock ticks to re-evaluate companion state. */
const TICK_INTERVAL_MS = 5_000;

/**
 * Derived companion connection state based on heartbeat age.
 * - `loading`: query hasn't resolved yet
 * - `connected`: heartbeat received within {@link STALE_THRESHOLD_MS}
 * - `stale`: heartbeat older than stale threshold but within offline threshold
 * - `offline`: no heartbeat or older than {@link OFFLINE_THRESHOLD_MS}
 */
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

/**
 * React hook that returns the companion server's connection state for an org.
 * Uses a shared 5-second clock via `useSyncExternalStore` to periodically
 * re-derive state from the last heartbeat timestamp without per-component timers.
 */
export function useCompanionStatus(
  orgId: Id<'organizations'> | null | undefined,
) {
  const status = useQuery(api.companion.getStatus, orgId ? { orgId } : 'skip');
  const currentTime = useSyncExternalStore(subscribe, getSnapshot);

  // status === undefined means the query hasn't resolved yet (or is skipped)
  const state: CompanionState =
    status === undefined
      ? 'loading'
      : deriveState(status?.lastSeen, currentTime);

  return { state, status, companionUrl: status?.url ?? null };
}
