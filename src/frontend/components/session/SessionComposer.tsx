import { ComposerPrimitive, useComposerRuntime } from '@assistant-ui/react';
import { SendHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useSessionActions } from './SessionActionsContext';

export default function SessionComposer() {
  const { sessionStatus, promptSuggestion } = useSessionActions();
  const isDisabled = sessionStatus !== 'idle';
  const composerRuntime = useComposerRuntime();

  const [chipDismissed, setChipDismissed] = useState(false);
  const [prevSuggestion, setPrevSuggestion] = useState(promptSuggestion);
  if (promptSuggestion !== prevSuggestion) {
    setPrevSuggestion(promptSuggestion);
    setChipDismissed(false);
  }

  const showChip = !isDisabled && promptSuggestion && !chipDismissed;

  const placeholder = isDisabled
    ? 'Waiting for session to finish…'
    : 'Send a follow-up to Claude… (Enter to send)';

  return (
    <>
      {showChip && (
        <div className="px-3 pt-2">
          <button
            type="button"
            aria-label={`Use suggestion: ${promptSuggestion}`}
            onClick={() => {
              composerRuntime.setText(promptSuggestion);
              setChipDismissed(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/30 px-3 py-1 text-xs text-muted-foreground hover:bg-muted/50 transition-colors max-w-full"
          >
            <span className="truncate">{promptSuggestion}</span>
          </button>
        </div>
      )}
      <ComposerPrimitive.Root className="shrink-0 border-t bg-muted/10 px-3 py-2">
        <div className="flex items-end gap-2">
          <ComposerPrimitive.Input
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-11 max-h-36 leading-relaxed"
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
    </>
  );
}
