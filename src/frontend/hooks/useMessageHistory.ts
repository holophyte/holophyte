import { useCallback, useRef } from 'react';

interface UseMessageHistoryReturn {
  /** Call when a message is successfully sent to record it in history. */
  push: (text: string) => void;
  /** Handle up/down arrow keys. Returns the text to set, or null if no action. */
  handleArrowKey: (
    direction: 'up' | 'down',
    currentText: string,
  ) => string | null;
  /** Reset navigation index (call when user types manually). */
  resetNavigation: () => void;
}

export function useMessageHistory(): UseMessageHistoryReturn {
  const historyRef = useRef<string[]>([]);
  const indexRef = useRef<number>(-1);
  const draftRef = useRef<string>('');

  const push = useCallback((text: string) => {
    historyRef.current.push(text);
    indexRef.current = -1;
    draftRef.current = '';
  }, []);

  const handleArrowKey = useCallback(
    (direction: 'up' | 'down', currentText: string): string | null => {
      const history = historyRef.current;

      if (direction === 'up') {
        if (history.length === 0) return null;
        if (indexRef.current === -1) {
          draftRef.current = currentText;
          indexRef.current = history.length - 1;
          return history[indexRef.current] ?? null;
        }
        if (indexRef.current > 0) {
          indexRef.current -= 1;
          return history[indexRef.current] ?? null;
        }
        // indexRef === 0: already at oldest
        return null;
      }

      // direction === 'down'
      if (indexRef.current === -1) return null;
      if (indexRef.current < history.length - 1) {
        indexRef.current += 1;
        return history[indexRef.current] ?? null;
      }
      // indexRef === history.length - 1: restore draft
      indexRef.current = -1;
      return draftRef.current;
    },
    [],
  );

  const resetNavigation = useCallback(() => {
    indexRef.current = -1;
  }, []);

  return { push, handleArrowKey, resetNavigation };
}
