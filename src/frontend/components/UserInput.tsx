import { Send } from 'lucide-react';
import { useRef, useState } from 'react';
import Button from './ui/Button';

/** Props for {@link UserInput}. */
interface UserInputProps {
  /** The active Convex session ID, or `null` when no session is selected. */
  sessionId: string | null;
  /**
   * When `true`, disables the textarea and send button. Pass `true` when
   * the session is running, failed, or otherwise not accepting input.
   */
  disabled?: boolean;
  /**
   * When `true`, shows a subtle indicator that the sent message is queued and
   * will be delivered once the current Claude turn finishes.
   */
  queued?: boolean;
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
 * - Shows a "waiting" placeholder when `disabled` is `true`.
 */
export default function UserInput({
  sessionId,
  disabled,
  queued,
  onSend,
}: UserInputProps) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = !disabled && !sending && text.trim().length > 0 && sessionId;
  const disabledReason = disabled
    ? 'Input is disabled while the session is busy or has ended'
    : null;

  const resizeTextarea = (textarea: HTMLTextAreaElement) => {
    const lineHeight = 24;
    const maxHeight = lineHeight * 6;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
  };

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
    ? 'Waiting for session to become idle…'
    : 'Send a message to Claude… (Cmd+Enter to send)';

  return (
    <div className="shrink-0 border-t bg-muted/10 px-3 py-2">
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            resizeTextarea(e.target);
          }}
          placeholder={placeholder}
          disabled={disabled || sending}
          rows={1}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-11 max-h-36 leading-relaxed"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          size="icon"
          className="h-11 w-11 shrink-0"
          disabled={!canSend}
          onClick={() => void handleSend()}
          aria-label="Send message"
          aria-describedby={disabledReason ? 'send-disabled-reason' : undefined}
          title={disabledReason ?? undefined}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
      {disabledReason && (
        <p
          id="send-disabled-reason"
          className="text-xs text-muted-foreground mt-1"
        >
          {disabledReason}
        </p>
      )}
      {queued && !error && (
        <p className="text-xs text-muted-foreground/60 mt-1">
          Message queued — will be sent when Claude finishes the current turn.
        </p>
      )}
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}
