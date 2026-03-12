import { MessageCircle, Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/frontend/lib/utils';

interface CompanionPanelProps {
  open: boolean;
  onClose: () => void;
}

export default function CompanionPanel({ open, onClose }: CompanionPanelProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  return (
    <>
      {/* Collapsed tab */}
      {!open && (
        <button
          type="button"
          aria-label="Open Companion panel (Cmd+Shift+C)"
          className={cn(
            'fixed right-0 top-1/2 -translate-y-1/2 z-40',
            'flex flex-col items-center justify-center gap-1.5',
            'w-7 py-4 rounded-l-lg',
            'bg-accent border border-border border-r-0',
            'text-muted-foreground hover:text-foreground',
            'transition-colors duration-150 cursor-pointer',
          )}
          onClick={onClose}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          <span className="text-[10px] font-medium [writing-mode:vertical-lr] rotate-180 tracking-wide">
            Companion
          </span>
        </button>
      )}

      {/* Panel */}
      <aside
        aria-label="Companion chat panel"
        id="companion-panel"
        className={cn(
          'fixed right-0 top-0 h-full z-50 flex flex-col',
          'w-80 bg-card border-l border-border shadow-xl',
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Companion</span>
          </div>
          <button
            type="button"
            aria-label="Close Companion panel"
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Context bar */}
        <div className="px-4 py-2 border-b border-border/50 shrink-0">
          <p className="text-xs text-muted-foreground">
            Seeing 5 agents · 12 tasks · 3 queue items
          </p>
        </div>

        {/* Chat thread */}
        <div
          role="log"
          aria-label="Companion conversation"
          aria-live="polite"
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        >
          {/* User message */}
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2">
              <p className="text-xs text-primary-foreground leading-relaxed">
                What should I work on next? I have about 20 minutes.
              </p>
            </div>
          </div>

          {/* Companion message */}
          <div className="flex justify-start">
            <div className="max-w-[90%] space-y-2">
              <div className="rounded-lg rounded-bl-sm bg-accent px-3 py-2">
                <p className="text-xs text-foreground leading-relaxed">
                  Based on your backlog, here are two quick tasks that fit your
                  timeframe:
                </p>
              </div>

              {/* Suggestion card */}
              <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-foreground">
                    1. Add rate limiting to /api/auth
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ~15 min · straightforward middleware addition · #47
                  </p>
                </div>
                <div className="h-px bg-border/50" />
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    2. Fix #52 — broken pagination
                  </p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    ~10 min · one-line offset bug in query · #52
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Follow-up companion message */}
          <div className="flex justify-start">
            <div className="max-w-[90%] rounded-lg rounded-bl-sm bg-accent px-3 py-2">
              <p className="text-xs text-foreground leading-relaxed">
                Want me to draft prompts for either of these?
              </p>
            </div>
          </div>
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-1.5 focus-within:ring-1 focus-within:ring-ring transition-shadow">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Ask anything about your project..."
              aria-label="Message to Companion"
              className="flex-1 bg-transparent text-xs placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <button
              type="button"
              aria-label="Send message"
              className="text-muted-foreground hover:text-foreground transition-colors duration-150 disabled:opacity-40 cursor-pointer"
              disabled={!inputValue.trim()}
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground/60 text-center">
            Cmd+Shift+C to toggle
          </p>
        </div>
      </aside>
    </>
  );
}
