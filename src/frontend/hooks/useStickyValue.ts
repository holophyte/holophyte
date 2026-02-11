import { useRef } from 'react';

/**
 * Returns the most recent non-undefined value.
 * Useful for keeping previous query results visible while new data loads,
 * preventing flash-to-empty during Convex query transitions.
 *
 * Pass an optional `key` to reset the sticky ref when the data source changes
 * (e.g. taskId), preventing stale data from a previous entity leaking through.
 */
export function useStickyValue<T>(
  value: T | undefined,
  key?: unknown,
): T | undefined {
  const ref = useRef(value);
  const prevKeyRef = useRef(key);

  if (key !== undefined && key !== prevKeyRef.current) {
    prevKeyRef.current = key;
    ref.current = value;
  } else if (value !== undefined) {
    ref.current = value;
  }

  return value ?? ref.current;
}
