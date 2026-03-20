import { ComposerPrimitive, useComposerRuntime } from '@assistant-ui/react';
import { SendHorizontal } from 'lucide-react';
import { useSessionActions } from './SessionActionsContext';

export default function SessionComposer() {
  const { sessionStatus, promptSuggestion } = useSessionActions();
  const isDisabled = sessionStatus !== 'idle';
  const composerRuntime = useComposerRuntime();

  const hasSuggestion = !isDisabled && !!promptSuggestion;

  const placeholder = isDisabled
    ? 'Waiting for session to finish…'
    : hasSuggestion
      ? `${promptSuggestion}  (Tab to accept)`
      : 'Send a follow-up to Claude… (Enter to send)';

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex items-end gap-2">
        <ComposerPrimitive.Input
          placeholder={placeholder}
          disabled={isDisabled}
          rows={1}
          onKeyDown={(e) => {
            if (e.key === 'Tab' && hasSuggestion) {
              e.preventDefault();
              composerRuntime.setText(promptSuggestion);
            }
          }}
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
  );
}
