import { ThreadPrimitive, useThreadViewport } from '@assistant-ui/react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import CustomAssistantMessage from './CustomAssistantMessage';
import CustomUserMessage from './CustomUserMessage';
import { useSessionActions } from './SessionActionsContext';
import SessionComposer from './SessionComposer';

/** Minimum distance (px) from bottom before the scroll button appears */
const SCROLL_THRESHOLD = 200;

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

function useScrollDistance() {
  const [show, setShow] = useState(false);
  const viewportRef = useRef<HTMLElement | null>(null);

  const handleScroll = useCallback((e: Event) => {
    const el = e.target as HTMLElement;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShow(distance > SCROLL_THRESHOLD);
  }, []);

  // Ref callback to place on a node inside the scrollable viewport
  const sentinelRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (viewportRef.current) {
        viewportRef.current.removeEventListener('scroll', handleScroll);
        viewportRef.current = null;
      }

      if (!node) return;

      // Walk up to the scrollable parent
      let el: HTMLElement | null = node.parentElement;
      while (el) {
        const { overflowY } = getComputedStyle(el);
        if (overflowY === 'auto' || overflowY === 'scroll') {
          viewportRef.current = el;
          el.addEventListener('scroll', handleScroll, { passive: true });
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          setShow(distance > SCROLL_THRESHOLD);
          break;
        }
        el = el.parentElement;
      }
    },
    [handleScroll],
  );

  return { show, sentinelRef };
}

export default function SessionThread() {
  const scrollToBottom = useThreadViewport((s) => s.scrollToBottom);
  const { show, sentinelRef } = useScrollDistance();

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
        <div ref={sentinelRef} className="hidden" aria-hidden="true" />
      </ThreadPrimitive.Viewport>
      <button
        type="button"
        aria-label="Scroll to bottom"
        onClick={() => scrollToBottom({ behavior: 'smooth' })}
        className={cn(
          'absolute bottom-20 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-background shadow-md border border-border text-muted-foreground hover:text-foreground transition-all duration-200',
          show
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-2 pointer-events-none',
        )}
      >
        <ChevronDown className="h-4 w-4" />
      </button>
      <SessionComposer />
    </ThreadPrimitive.Root>
  );
}
