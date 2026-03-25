import {
  ComposerPrimitive,
  useComposer,
  useComposerRuntime,
} from '@assistant-ui/react';
import { SendHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useSessionActions } from './SessionActionsContext';
import SlashCommandMenu, { filterCommands } from './SlashCommandMenu';

export default function SessionComposer() {
  const { sessionStatus, promptSuggestion, availableCommands } =
    useSessionActions();
  const isDisabled = sessionStatus !== 'idle';
  const composerRuntime = useComposerRuntime();
  const composerText = useComposer((s) => s.text);
  const isEmpty = !composerText.trim();

  const hasSuggestion = !isDisabled && !!promptSuggestion;

  // Slash command menu state
  const userDismissedRef = useRef(false);
  const [isFocused, setIsFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Determine if the input starts with "/" and extract the filter text
  const slashMatch = composerText.match(/^\/(\S*)$/);
  const slashFilter = slashMatch?.[1] ?? '';

  // Reset dismissed state when the slash pattern is no longer present
  const hasSlashMatch = slashMatch !== null;
  useEffect(() => {
    if (!hasSlashMatch) {
      userDismissedRef.current = false;
    }
  }, [hasSlashMatch]);

  const showMenu =
    isFocused &&
    !userDismissedRef.current &&
    hasSlashMatch &&
    availableCommands.length > 0;
  const filteredCommands = showMenu
    ? filterCommands(availableCommands, slashFilter)
    : [];

  const handleSelectCommand = useCallback(
    (name: string) => {
      composerRuntime.setText(`/${name} `);
      setSelectedIndex(0);
    },
    [composerRuntime],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Slash command menu keyboard navigation
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
        if (e.key === 'Tab') {
          e.preventDefault();
          const cmd = filteredCommands[selectedIndex];
          if (cmd) handleSelectCommand(cmd.name);
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          const cmd = filteredCommands[selectedIndex];
          if (cmd) handleSelectCommand(cmd.name);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          userDismissedRef.current = true;
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
        composerRuntime.setText(promptSuggestion);
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
      composerRuntime,
    ],
  );

  const placeholder = isDisabled
    ? 'Waiting for session to finish…'
    : hasSuggestion
      ? `${promptSuggestion}  [tab]`
      : 'Send a follow-up to Claude… (Enter to send)';

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="relative flex items-end gap-2">
        {showMenu && (
          <SlashCommandMenu
            commands={availableCommands}
            filter={slashFilter}
            selectedIndex={selectedIndex}
            onSelect={handleSelectCommand}
          />
        )}
        <ComposerPrimitive.Input
          placeholder={placeholder}
          disabled={isDisabled}
          rows={1}
          onKeyDown={handleKeyDown}
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
          onChange={() => {
            // Reset selection on each keystroke
            setSelectedIndex(0);
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          className={cn(
            'flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-11 max-h-36 leading-relaxed',
            hasSuggestion
              ? 'placeholder:italic placeholder:text-muted-foreground/40'
              : 'placeholder:text-muted-foreground/50',
          )}
        />
        <ComposerPrimitive.Send
          disabled={isDisabled}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground shadow hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          aria-label="Send message"
        >
          <SendHorizontal className="h-4 w-4" />
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
