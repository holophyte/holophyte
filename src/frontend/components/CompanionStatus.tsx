import { Monitor } from 'lucide-react';
import type { CompanionState } from '@/frontend/hooks/useCompanionStatus';
import { useCompanionStatus } from '@/frontend/hooks/useCompanionStatus';
import { cn } from '@/frontend/lib/utils';
import Skeleton from './ui/Skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/Tooltip';

const dotStyles: Record<CompanionState, string> = {
  loading: '',
  connected: 'bg-green-500',
  stale: 'bg-yellow-400 animate-pulse',
  offline: 'bg-gray-400',
};

const labels: Record<CompanionState, string> = {
  loading: '',
  connected: 'Connected',
  stale: 'Stale',
  offline: 'Offline',
};

export default function CompanionStatus() {
  const { state, status } = useCompanionStatus();

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5">
        <Skeleton className="h-3.5 w-3.5 rounded" />
        <Skeleton className="h-3.5 w-16" />
      </div>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <output
            className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-muted-foreground"
            aria-label={`Companion ${labels[state]}`}
          >
            <Monitor className="h-3.5 w-3.5 shrink-0" />
            <span
              aria-hidden="true"
              className={cn('h-2 w-2 shrink-0 rounded-full', dotStyles[state])}
            />
            <span>{labels[state]}</span>
          </output>
        </TooltipTrigger>
        <TooltipContent side="right">
          <div className="space-y-1">
            <p className="font-medium">Companion {labels[state]}</p>
            {status?.lastSeen ? (
              <>
                <p>
                  Last seen: {new Date(status.lastSeen).toLocaleTimeString()}
                </p>
                <p>Active sessions: {status.activeSessionCount}</p>
              </>
            ) : (
              <p>No heartbeat received</p>
            )}
            {state === 'offline' && (
              <p className="text-yellow-300">
                Tasks will queue but won't execute until the companion
                reconnects.
              </p>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
