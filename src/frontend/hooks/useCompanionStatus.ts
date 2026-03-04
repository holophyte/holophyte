import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { useEffect, useState } from 'react';

const STALE_THRESHOLD_MS = 30_000;
const OFFLINE_THRESHOLD_MS = 5 * 60_000;
const TICK_INTERVAL_MS = 5_000;

export type CompanionState = 'connected' | 'stale' | 'offline';

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

export function useCompanionStatus() {
  const status = useQuery(api.companion.getStatus);
  const [now, setNow] = useState(Date.now());

  // Tick every 5s to re-evaluate staleness
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const state = deriveState(status?.lastSeen, now);

  return { state, status };
}
