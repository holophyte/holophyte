import { Send } from 'lucide-react';
import { useState } from 'react';
import Button from './ui/Button';

/** Props for {@link UserInput}. */
interface UserInputProps {
  /** The active Convex session ID, or `null` when no session is selected. */
  sessionId: string | null;
  /**
   * When `true`, disables the textarea and send button. Pass `true` when
   * the session is completed, failed, or stopped.
   */
  disabled?: boolean;
  /**
   * Called when the user submits a message. Receives the session ID and the
   * trimmed message text. Should forward to {@link useSession.sendMessage}.
   */
  onSend: (sessionId: string, text: string) => Promise<void>;
}

/**
 * Multi-line text input bar pinned to the bottom of the session panel for
 * sending follow-up messages to Claude mid-session.
 *
 * - Supports Cmd+Enter (macOS) or Ctrl+Enter to submit.
 * - Clears the textarea on successful send.
 * - Shows "Session completed" as placeholder when `disabled` is `true`.
 */
export function UserInput({ sessionId, disabled, onSend }: UserInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = !disabled && !sending && text.trim().length > 0 && sessionId;

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await onSend(sessionId, text.trim());
      setText('');
    } catch {
      setError('Failed to send message. Try again.');
    } finally {
      setSending(false);
    }
  };

  const placeholder = disabled
    ? 'Session completed'
    : 'Send a message to Claude… (Cmd+Enter to send)';

  return (
    <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex gap-2 items-end">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={2}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[2.5rem] max-h-32 overflow-y-auto leading-relaxed"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          size="icon"
          className="h-9 w-9 shrink-0"
          disabled={!canSend}
          onClick={() => void handleSend()}
          aria-label="Send message"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
