import { ComposerPrimitive, ThreadPrimitive } from '@assistant-ui/react';
import { SendHorizontal } from 'lucide-react';
import { useSessionActions } from './SessionActionsContext';

export default function SessionComposer() {
  const { sessionStatus, suggestions } = useSessionActions();
  const isDisabled = sessionStatus !== 'idle';

  const placeholder = isDisabled
    ? 'Waiting for session to finish…'
    : 'Send a follow-up to Claude… (Enter to send)';

  // Show the most recent suggestion only when idle
  const latestSuggestion = !isDisabled ? suggestions.at(-1) : undefined;

  return (
    <div className="shrink-0 border-t bg-muted/10">
      {latestSuggestion && (
        <div className="px-3 pt-2">
          <ThreadPrimitive.Suggestion
            prompt={latestSuggestion}
            method="replace"
            autoSend
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <span className="truncate">{latestSuggestion}</span>
          </ThreadPrimitive.Suggestion>
        </div>
      )}
      <div className="flex items-end gap-2 px-3 py-2">
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
    </div>
  );
}
