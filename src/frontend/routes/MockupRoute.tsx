import { Bell, LayoutGrid, ListChecks } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Badge from '@/frontend/components/ui/Badge';
import Button from '@/frontend/components/ui/Button';
import { cn } from '@/frontend/lib/utils';
import CompanionPanel from './mockup/CompanionPanel';
import DecisionQueue from './mockup/DecisionQueue';
import DigestModal from './mockup/DigestModal';
import FocusMode from './mockup/FocusMode';
import type { MockupView } from './mockup/types';

export default function MockupRoute() {
  const [view, setView] = useState<MockupView>('queue');
  const [companionOpen, setCompanionOpen] = useState(false);
  const [digestOpen, setDigestOpen] = useState(true);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl+Shift+C — toggle companion
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        setCompanionOpen((o) => !o);
        return;
      }

      // Escape — return to queue from focus mode
      if (e.key === 'Escape') {
        if (view === 'focus') {
          setView('queue');
        }
        if (companionOpen) {
          setCompanionOpen(false);
        }
        if (digestOpen) {
          setDigestOpen(false);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, companionOpen, digestOpen]);

  const goToFocus = useCallback(() => {
    setView('focus');
  }, []);

  const goToQueue = useCallback(() => {
    setView('queue');
  }, []);

  const handleDigestReview = useCallback(() => {
    setDigestOpen(false);
    setView('queue');
  }, []);

  return (
    <div
      className="flex flex-col h-full bg-background text-foreground overflow-hidden"
      data-testid="mockup-route"
    >
      {/* Skip links */}
      <a
        href="#queue-items"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:text-xs focus:rounded focus:bg-primary focus:text-primary-foreground"
      >
        Skip to queue items
      </a>
      <a
        href="#companion-panel"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-20 focus:z-50 focus:px-3 focus:py-1.5 focus:text-xs focus:rounded focus:bg-primary focus:text-primary-foreground"
      >
        Skip to companion
      </a>

      {/* Top nav */}
      <header className="shrink-0 flex items-center gap-0 px-4 py-2.5 border-b border-border/50 bg-card/50">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-6">
          <div className="h-6 w-6 rounded bg-primary flex items-center justify-center">
            <span className="text-[10px] font-bold text-primary-foreground">
              H
            </span>
          </div>
          <span className="font-semibold text-sm">Holophyte</span>
        </div>

        {/* Nav tabs */}
        <nav className="flex items-center gap-1" aria-label="Main navigation">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'queue'}
            onClick={() => setView('queue')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 cursor-pointer',
              view === 'queue'
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            <ListChecks className="h-4 w-4" />
            Queue
            <Badge
              variant="default"
              className="h-4 min-w-4 px-1 text-[10px] rounded-full"
              aria-label="3 items in queue"
            >
              3
            </Badge>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={false}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors duration-150 cursor-pointer"
          >
            <LayoutGrid className="h-4 w-4" />
            Board
          </button>
        </nav>

        {/* Right side */}
        <div className="ml-auto flex items-center gap-3">
          {/* While away digest button */}
          <button
            type="button"
            onClick={() => setDigestOpen(true)}
            aria-label="View activity digest"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors duration-150 cursor-pointer px-2 py-1.5 rounded-md hover:bg-accent/50"
          >
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Digest</span>
          </button>

          {/* Agent count */}
          <div className="flex items-center gap-1.5 text-xs" aria-live="polite">
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500 motion-safe:animate-pulse"
              aria-hidden="true"
            />
            <span className="text-muted-foreground">5 agents active</span>
          </div>

          {/* Companion toggle */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCompanionOpen((o) => !o)}
            aria-expanded={companionOpen}
            aria-controls="companion-panel"
            className="text-xs h-7 px-2.5 gap-1.5"
          >
            Companion
            <kbd className="text-[10px] opacity-60">⌘⇧C</kbd>
          </Button>
        </div>
      </header>

      {/* Main content area */}
      <main
        className="flex-1 min-h-0 overflow-hidden flex flex-col"
        id="queue-items"
      >
        {view === 'queue' && <DecisionQueue onFocusTask={goToFocus} />}
        {view === 'focus' && <FocusMode onBack={goToQueue} />}
      </main>

      {/* Companion panel overlay */}
      <CompanionPanel
        open={companionOpen}
        onClose={() => setCompanionOpen((o) => !o)}
      />

      {/* Digest modal */}
      <DigestModal
        open={digestOpen}
        onClose={() => setDigestOpen(false)}
        onReview={handleDigestReview}
      />
    </div>
  );
}
