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
}

export default function SessionThread({
  messages,
  status,
}: SessionThreadProps) {
  const { sessionStatus } = useSessionActions();
  const isRunning = sessionStatus === 'running';
  const isStreaming = status === 'streaming';

  return (
    <Conversation className="flex h-full flex-col">
      <ConversationContent className="mx-auto w-full max-w-[90ch] space-y-5">
        {messages.map((msg) =>
          msg.parts.map((part, i) => {
            const partKey = `${msg.id}-${i}`;
            if (part.type === 'text') {
              if (msg.role === 'user') {
                return (
                  <Message key={partKey} from="user">
                    <MessageContent>
                      <div className="flex gap-2 rounded-md bg-muted/60 px-3 py-2">
                        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
                          {part.text}
                        </p>
                      </div>
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
              return <ToolCallUI key={part.toolCallId} part={part} />;
            }
            if (part.type === 'reasoning') {
              return (
                <Message key={partKey} from="assistant" className="max-w-full">
                  <MessageContent className="w-full">
                    <Reasoning isStreaming={false}>
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
      </ConversationContent>
      <div className="relative shrink-0">
        <ConversationScrollButton className="bottom-full mb-2" />
        <SessionComposer />
      </div>
    </Conversation>
  );
}
