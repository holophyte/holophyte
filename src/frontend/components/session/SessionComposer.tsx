import { SendHorizontal, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMessageHistory } from '@/frontend/hooks/useMessageHistory';
import { cn } from '@/frontend/lib/utils';
import { useSessionActions } from './SessionActionsContext';
import SlashCommandMenu, { filterCommands } from './SlashCommandMenu';

/** Keys that should not reset history navigation when pressed. */
const NAVIGATION_PASSTHROUGH_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'Enter',
  'Tab',
  'Shift',
  'Control',
  'Alt',
  'Meta',
  'Escape',
]);

export default function SessionComposer() {
  const {
    sessionStatus,
    promptSuggestion,
    availableCommands,
    handleStop,
    messageQueued,
    sendMessage,
    addOptimisticMessage,
  } = useSessionActions();

  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isEmpty = !text.trim();
  const [stopping, setStopping] = useState(false);
  const history = useMessageHistory();

  const isSessionActive =
    sessionStatus === 'running' || sessionStatus === 'queued';
  const hasSuggestion = sessionStatus === 'idle' && !!promptSuggestion;
  const showStop = isEmpty && isSessionActive;

  // Slash command menu state
  const [dismissed, setDismissed] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Determine if the input starts with "/" and extract the filter text
  const slashMatch = text.match(/^\/(\S*)$/);
  const slashFilter = slashMatch?.[1] ?? '';

  // Reset dismissed state when the slash pattern is no longer present
  const hasSlashMatch = slashMatch !== null;
  useEffect(() => {
    if (!hasSlashMatch) {
      setDismissed(false);
    }
  }, [hasSlashMatch]);

  const showMenu =
    isFocused && !dismissed && hasSlashMatch && availableCommands.length > 0;
  const filteredCommands = showMenu
    ? filterCommands(availableCommands, slashFilter)
    : [];

  const handleSelectCommand = useCallback((name: string) => {
    setText(`/${name} `);
    setSelectedIndex(0);
  }, []);

  let placeholder: string;
  if (sessionStatus === 'waiting_input') {
    placeholder = 'Waiting for tool approval…';
  } else if (isSessionActive && isEmpty) {
    placeholder = 'Type a follow-up or press Enter to stop…';
  } else if (hasSuggestion) {
    placeholder = `${promptSuggestion}  [tab]`;
  } else {
    placeholder = 'Send a follow-up to Claude… (Enter to send)';
  }

  const handleStopWithState = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await handleStop();
    } catch (err) {
      console.error('Failed to stop session:', err);
    } finally {
      setStopping(false);
    }
  }, [handleStop, stopping]);

  const handleSend = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) return;
      addOptimisticMessage(trimmed);
      setText('');
      sendMessage(trimmed)
        .then(() => history.push(trimmed))
        .catch((err) => console.error('Failed to send message:', err));
    },
    [addOptimisticMessage, sendMessage, history],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Slash command menu keyboard navigation takes priority
      if (showMenu && filteredCommands.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredCommands.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedIndex((i) =>
            i <= 0 ? filteredCommands.length - 1 : i - 1,
          );
          return;
        }
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault();
          const cmd = filteredCommands[selectedIndex];
          if (cmd) handleSelectCommand(cmd.name);
          return;
        }
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const cmd = filteredCommands[selectedIndex];
          if (cmd) handleSelectCommand(cmd.name);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDismissed(true);
          return;
        }
      }

      // Prompt suggestion Tab completion (only when input is empty)
      if (
        e.key === 'Tab' &&
        !e.shiftKey &&
        hasSuggestion &&
        promptSuggestion &&
        isEmpty
      ) {
        e.preventDefault();
        setText(promptSuggestion);
        return;
      }

      // Enter on empty + running/queued = stop
      if (e.key === 'Enter' && !e.shiftKey && isEmpty && isSessionActive) {
        e.preventDefault();
        void handleStopWithState();
        return;
      }

      // Enter on non-empty = send
      if (e.key === 'Enter' && !e.shiftKey && !isEmpty) {
        e.preventDefault();
        handleSend(text);
        return;
      }

      // ArrowUp = navigate history backward — only when cursor is at the start
      if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
        const next = history.handleArrowKey('up', text);
        if (next !== null) {
          e.preventDefault();
          setText(next);
        }
        return;
      }

      // ArrowDown = navigate history forward — only when cursor is at the end
      if (
        e.key === 'ArrowDown' &&
        e.currentTarget.selectionStart === e.currentTarget.value.length
      ) {
        const next = history.handleArrowKey('down', text);
        if (next !== null) {
          e.preventDefault();
          setText(next);
        }
        return;
      }

      // Any other key while navigating = reset navigation
      if (!NAVIGATION_PASSTHROUGH_KEYS.has(e.key)) {
        history.resetNavigation();
      }
    },
    [
      showMenu,
      filteredCommands,
      selectedIndex,
      handleSelectCommand,
      hasSuggestion,
      promptSuggestion,
      isEmpty,
      isSessionActive,
      handleStopWithState,
      handleSend,
      text,
      history,
    ],
  );

  return (
    <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="relative flex items-end gap-2">
        {showMenu && (
          <SlashCommandMenu
            commands={availableCommands}
            filter={slashFilter}
            selectedIndex={selectedIndex}
            onSelect={handleSelectCommand}
          />
        )}
        <textarea
          ref={textareaRef}
          value={text}
          placeholder={placeholder}
          aria-label={
            isSessionActive
              ? showStop
                ? 'Follow-up message — press Enter to stop session, or type a message'
                : 'Follow-up message — press Enter to send'
              : 'Send a follow-up to Claude'
          }
          disabled={
            sessionStatus === 'failed' || sessionStatus === 'waiting_input'
          }
          rows={1}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={showMenu && filteredCommands.length > 0}
          aria-controls={
            showMenu && filteredCommands.length > 0
              ? 'slash-command-menu'
              : undefined
          }
          aria-activedescendant={
            showMenu &&
            filteredCommands.length > 0 &&
            filteredCommands[selectedIndex]
              ? `slash-cmd-${filteredCommands[selectedIndex].name}`
              : undefined
          }
          onChange={(e) => {
            setText(e.target.value);
            setSelectedIndex(0);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-11 max-h-36 leading-relaxed',
            hasSuggestion
              ? 'placeholder:italic placeholder:text-muted-foreground/40'
              : 'placeholder:text-muted-foreground/50',
          )}
        />
        {showStop ? (
          <button
            type="button"
            onClick={() => void handleStopWithState()}
            disabled={stopping}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-destructive text-destructive-foreground shadow hover:bg-destructive/90 disabled:pointer-events-none disabled:opacity-50"
            aria-label="Stop session"
          >
            <Square className="h-4 w-4" />
          </button>
        ) : isSessionActive ? (
          <button
            type="button"
            disabled={isEmpty}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            aria-label="Send message"
            onClick={() => handleSend(text)}
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={isEmpty}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
            aria-label="Send message"
            onClick={() => handleSend(text)}
          >
            <SendHorizontal className="h-4 w-4" />
          </button>
        )}
      </div>
      <div aria-live="polite" aria-atomic="true">
        {messageQueued && (
          <p className="px-1 text-xs text-muted-foreground">
            Message queued — will be delivered when Claude finishes its current
            turn.
          </p>
        )}
      </div>
    </div>
  );
}
