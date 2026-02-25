import { ThreadPrimitive } from '@assistant-ui/react';
import { Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import CustomAssistantMessage from './CustomAssistantMessage';
import CustomUserMessage from './CustomUserMessage';
import { useSessionActions } from './SessionActionsContext';
import SessionComposer from './SessionComposer';

function ThinkingIndicator() {
  const { sessionStatus } = useSessionActions();
  const isRunning = sessionStatus === 'running';
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

export default function SessionThread() {
  return (
    <ThreadPrimitive.Root className="relative flex h-full flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4">
        <div className="w-full max-w-[90ch] space-y-5">
          <ThreadPrimitive.Messages
            components={{
              UserMessage: CustomUserMessage,
              AssistantMessage: CustomAssistantMessage,
            }}
          />
          <ThinkingIndicator />
        </div>
      </ThreadPrimitive.Viewport>
      <ThreadPrimitive.ScrollToBottom className="absolute bottom-20 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-md border border-border text-muted-foreground hover:text-foreground" />
      <SessionComposer />
    </ThreadPrimitive.Root>
  );
}
