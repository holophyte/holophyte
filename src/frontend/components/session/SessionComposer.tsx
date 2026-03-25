import {
  ComposerPrimitive,
  useComposer,
  useComposerRuntime,
} from '@assistant-ui/react';
import { SendHorizontal, Square } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useSessionActions } from './SessionActionsContext';

export default function SessionComposer() {
  const { sessionStatus, promptSuggestion, requestStop } = useSessionActions();
  const composerRuntime = useComposerRuntime();
  const isEmpty = useComposer((s) => !s.text.trim());
  const text = useComposer((s) => s.text);

  const isActive = sessionStatus === 'running' || sessionStatus === 'queued';
  const isIdle = sessionStatus === 'idle';
  const hasSuggestion = isIdle && !!promptSuggestion;

  // --- Up-arrow message history (in-memory, current session) ---
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef(-1);
  const draftRef = useRef('');

  const pushHistory = useCallback((msg: string) => {
    setHistory((prev) => [...prev, msg]);
    historyIndexRef.current = -1;
  }, []);

  // --- Placeholder text ---
  const placeholder = isActive
    ? 'Send a follow-up to queue… (Enter to stop)'
    : hasSuggestion
      ? `${promptSuggestion}  [tab]`
      : 'Send a follow-up to Claude… (Enter to send)';

  // --- Dual-purpose button ---
  const showStop = isActive && isEmpty;
  const canSend = !isEmpty && (isIdle || isActive);

  const handleButtonClick = () => {
    if (showStop) {
      void requestStop();
    } else if (canSend) {
      pushHistory(text.trim());
      composerRuntime.send();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Tab to accept prompt suggestion
    if (
      e.key === 'Tab' &&
      !e.shiftKey &&
      hasSuggestion &&
      promptSuggestion &&
      isEmpty
    ) {
      e.preventDefault();
      composerRuntime.setText(promptSuggestion);
      return;
    }

    // Enter (no modifier) on empty input while active → stop
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      if (isActive && isEmpty) {
        e.preventDefault();
        void requestStop();
        return;
      }
      // Non-empty: capture to history before the form submits
      if (!isEmpty) {
        pushHistory(text.trim());
        historyIndexRef.current = -1;
      }
    }

    // ArrowUp on empty input → browse history
    if (e.key === 'ArrowUp' && isEmpty) {
      const nextIndex = historyIndexRef.current + 1;
      const entry = history[history.length - 1 - nextIndex];
      if (nextIndex < history.length && entry !== undefined) {
        e.preventDefault();
        if (historyIndexRef.current === -1) {
          draftRef.current = text;
        }
        historyIndexRef.current = nextIndex;
        composerRuntime.setText(entry);
      }
      return;
    }

    // ArrowDown while browsing history → go forward
    if (e.key === 'ArrowDown' && historyIndexRef.current >= 0) {
      e.preventDefault();
      const nextIndex = historyIndexRef.current - 1;
      if (nextIndex < 0) {
        historyIndexRef.current = -1;
        composerRuntime.setText(draftRef.current);
      } else {
        const entry = history[history.length - 1 - nextIndex];
        if (entry !== undefined) {
          historyIndexRef.current = nextIndex;
          composerRuntime.setText(entry);
        }
      }
      return;
    }

    // Any other key resets history browsing
    if (historyIndexRef.current >= 0 && e.key !== 'ArrowUp') {
      historyIndexRef.current = -1;
    }
  };

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex items-end gap-2">
        <ComposerPrimitive.Input
          placeholder={placeholder}
          rows={1}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-11 max-h-36 leading-relaxed',
            hasSuggestion
              ? 'placeholder:italic placeholder:text-muted-foreground/40'
              : 'placeholder:text-muted-foreground/50',
          )}
        />
        <button
          type="button"
          disabled={!showStop && !canSend}
          onClick={handleButtonClick}
          className={cn(
            'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md shadow disabled:pointer-events-none disabled:opacity-50',
            showStop
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : 'bg-primary text-primary-foreground hover:bg-primary/90',
          )}
          aria-label={showStop ? 'Stop session' : 'Send message'}
        >
          {showStop ? (
            <Square className="h-4 w-4" />
          ) : (
            <SendHorizontal className="h-4 w-4" />
          )}
        </button>
      </div>
    </ComposerPrimitive.Root>
  );
}
