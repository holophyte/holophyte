import { useRef } from 'react';

/**
 * Returns the most recent non-undefined value.
 * Useful for keeping previous query results visible while new data loads,
 * preventing flash-to-empty during Convex query transitions.
 */
export function useStickyValue<T>(value: T | undefined): T | undefined {
  const ref = useRef(value);
  if (value !== undefined) ref.current = value;
  return value ?? ref.current;
}
