import {
  ComposerPrimitive,
  useComposer,
  useComposerRuntime,
} from '@assistant-ui/react';
import { SendHorizontal } from 'lucide-react';
import { useSessionActions } from './SessionActionsContext';

export default function SessionComposer() {
  const { sessionStatus, promptSuggestion } = useSessionActions();
  const isDisabled = sessionStatus !== 'idle';
  const composerRuntime = useComposerRuntime();
  const isEmpty = useComposer((s) => !s.text.trim());

  const hasSuggestion = !isDisabled && !!promptSuggestion;

  const placeholder = isDisabled
    ? 'Waiting for session to finish…'
    : hasSuggestion
      ? promptSuggestion
      : 'Send a follow-up to Claude… (Enter to send)';

  return (
    <ComposerPrimitive.Root className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <ComposerPrimitive.Input
            placeholder={placeholder}
            disabled={isDisabled}
            rows={1}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && hasSuggestion && isEmpty) {
                e.preventDefault();
                composerRuntime.setText(promptSuggestion);
              }
            }}
            className={`w-full resize-none rounded-md border border-input bg-background py-2 pl-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-11 max-h-36 leading-relaxed ${hasSuggestion && isEmpty ? 'pr-12 placeholder:italic placeholder:text-muted-foreground/40' : 'pr-3 placeholder:text-muted-foreground/50'}`}
          />
          {hasSuggestion && isEmpty && (
            <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border/50 bg-muted/50 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/60">
              Tab
            </kbd>
          )}
        </div>
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
