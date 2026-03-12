import { CheckCircle2, Clock, DollarSign, X } from 'lucide-react';
import Button from '@/frontend/components/ui/Button';
import { cn } from '@/frontend/lib/utils';

interface DigestModalProps {
  open: boolean;
  onClose: () => void;
  onReview: () => void;
}

export default function DigestModal({
  open,
  onClose,
  onReview,
}: DigestModalProps) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="digest-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md mx-4 rounded-xl border border-border bg-card shadow-2xl">
        {/* Close */}
        <button
          type="button"
          aria-label="Close digest"
          onClick={onClose}
          className="absolute right-3 top-3 h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors duration-150 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="px-6 py-5 space-y-5">
          {/* Title */}
          <div>
            <h2 id="digest-title" className="text-lg font-semibold">
              Welcome back
            </h2>
            <div className="flex items-center gap-1.5 mt-1">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">45 min away</span>
            </div>
          </div>

          {/* Completed tasks */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Completed while away
            </h3>
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">
                    Add payment webhook (#38)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Stripe integration, 3 files changed
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">
                    Update CI pipeline (#41)
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Added test coverage report step
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Needs attention */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Needs your attention
            </h3>
            <div className="rounded-lg border border-border bg-background/50 divide-y divide-border">
              <div
                className={cn('flex items-center justify-between px-3 py-2')}
              >
                <span className="text-xs font-medium">
                  Permission approvals
                </span>
                <span className="text-xs font-semibold text-amber-500">
                  1 waiting
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium">Code reviews</span>
                <span className="text-xs font-semibold text-blue-400">
                  1 ready
                </span>
              </div>
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-medium">Error triages</span>
                <span className="text-xs font-semibold text-red-400">
                  1 needs help
                </span>
              </div>
            </div>
          </div>

          {/* Cost */}
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">
              Spent while away:{' '}
              <span className="font-semibold text-foreground">$0.52</span>
            </span>
          </div>

          {/* CTA */}
          <Button className="w-full" onClick={onReview}>
            Review 3 items
          </Button>
        </div>
      </div>
    </div>
  );
}
