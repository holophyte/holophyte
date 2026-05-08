import type { UIMessage } from 'ai';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/frontend/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/frontend/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/frontend/components/ai-elements/reasoning';
import { useSessionActions } from './SessionActionsContext';
import SessionComposer from './SessionComposer';
import ToolCallUI from './ToolCallUI';

interface ThinkingIndicatorProps {
  isRunning: boolean;
}

function ThinkingIndicator({ isRunning }: ThinkingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!isRunning) {
      setElapsed(0);
      return;
    }
    setElapsed(0);
    const interval = setInterval(() => {
      setElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!isRunning) return null;

  return (
    <output
      data-testid="thinking-indicator"
      aria-label="Claude is thinking"
      className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground/70"
    >
      <Sparkles className="h-3.5 w-3.5 pulse-spin animate-[pulse-spin_2s_linear_infinite]" />
      <span>Thinking… {elapsed > 0 ? `${elapsed}s` : ''}</span>
    </output>
  );
}

interface SessionThreadProps {
  messages: UIMessage[];
  status: 'ready' | 'submitted' | 'streaming' | 'error';
  /**
   * True when the previous turn was cut short (session idle, but the SDK
   * event stream never produced a terminal `result` event). Renders an
   * "— interrupted —" divider after the last message.
   */
  isInterrupted?: boolean;
  /**
   * Override for the thinking-indicator visibility. When provided, gates the
   * indicator instead of `sessionStatus === 'running'`. Codex sessions stay
   * `running` between turns, so session status alone leaves the spinner stuck;
   * the parent hook (`useHolophyteChat.isThinking`) factors in turn boundaries.
   */
  isThinking?: boolean;
}

export default function SessionThread({
  messages,
  status,
  isInterrupted = false,
  isThinking,
}: SessionThreadProps) {
  const { sessionStatus } = useSessionActions();
  const isRunning =
    isThinking !== undefined ? isThinking : sessionStatus === 'running';
  const isStreaming = status === 'streaming';
  // A user message is "queued" when it's still optimistic (no corresponding
  // SDK event yet) while the session is actively processing a prior turn.
  // The first active prompt is not optimistic — by the time the session is
  // running, it's been persisted as an SDK user event.
  const isSessionBusy =
    sessionStatus === 'running' || sessionStatus === 'waiting_input';
  const isQueuedMessage = (msg: UIMessage): boolean =>
    isSessionBusy && msg.id.startsWith('optimistic-');

  return (
    <Conversation className="relative flex h-full flex-col">
      <ConversationContent className="mx-auto w-full max-w-[90ch] space-y-5">
        {messages.map((msg) =>
          msg.parts.map((part, i) => {
            // Use a composite key: message id + part index. Part order is
            // stable within a single message after it's persisted to Convex.
            const partKey = `${msg.id}-${i}`;
            if (part.type === 'text') {
              if (msg.role === 'user') {
                const queued = isQueuedMessage(msg);
                return (
                  <Message
                    key={partKey}
                    from="user"
                    data-queued={queued ? 'true' : undefined}
                    className={queued ? 'opacity-60' : undefined}
                  >
                    <MessageContent>
                      {queued && (
                        <span
                          title="Will be sent when Claude finishes the current response"
                          className="mb-1 inline-block rounded-full border border-dashed px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
                        >
                          Queued
                        </span>
                      )}
                      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                        {part.text}
                      </p>
                    </MessageContent>
                  </Message>
                );
              }
              return (
                <Message key={partKey} from="assistant" className="max-w-full">
                  <MessageContent className="w-full">
                    <MessageResponse isAnimating={isStreaming}>
                      {part.text}
                    </MessageResponse>
                  </MessageContent>
                </Message>
              );
            }
            if (part.type === 'dynamic-tool') {
              // Rendered outside Message/MessageContent so it's full-width
              return <ToolCallUI key={part.toolCallId} part={part} />;
            }
            if (part.type === 'reasoning') {
              return (
                <Message key={partKey} from="assistant" className="max-w-full">
                  <MessageContent className="w-full">
                    <Reasoning isStreaming={isStreaming}>
                      <ReasoningTrigger />
                      <ReasoningContent>{part.text}</ReasoningContent>
                    </Reasoning>
                  </MessageContent>
                </Message>
              );
            }
            return null;
          }),
        )}
        {isRunning && <ThinkingIndicator isRunning={isRunning} />}
        {isInterrupted && !isSessionBusy && (
          <div
            data-testid="interruption-indicator"
            className="flex items-center gap-3 py-1 text-muted-foreground/70"
          >
            <div className="h-px flex-1 border-t border-dashed" />
            <span className="text-[10px] font-medium uppercase tracking-wide">
              Interrupted
            </span>
            <div className="h-px flex-1 border-t border-dashed" />
          </div>
        )}
      </ConversationContent>
      <ConversationScrollButton />
      <SessionComposer />
    </Conversation>
  );
}
