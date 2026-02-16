import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useQuery } from 'convex/react';
import { History } from 'lucide-react';
import { useState } from 'react';
import { formatTimeAgo } from '@/frontend/lib/dateUtils';
import { cn } from '@/frontend/lib/utils';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

interface PromptHistoryProps {
  taskId: Id<'tasks'>;
  historyCount: number;
  currentPrompt: string;
  onRestore: (prompt: string) => void;
}

export function PromptHistory({
  taskId,
  historyCount,
  currentPrompt,
  onRestore,
}: PromptHistoryProps) {
  const [open, setOpen] = useState(false);
  const history = useQuery(
    api.promptHistory.listByTask,
    open ? { taskId } : 'skip',
  );

  const hasHistory = historyCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 min-w-[5.5rem] gap-1 text-xs"
          disabled={!hasHistory}
        >
          <History className="h-3 w-3" />
          History
          <span className="ml-0.5 bg-muted rounded-full px-1.5 text-[10px]">
            {hasHistory ? historyCount : '-'}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="start">
        <p className="text-xs font-medium text-muted-foreground px-2 pb-1.5">
          Prompt History
        </p>
        <div className="space-y-0.5 max-h-72 overflow-y-auto">
          {(history ?? []).map((entry, i, arr) => {
            const isCurrent = entry.prompt === currentPrompt;
            return (
              <button
                key={entry._id}
                type="button"
                onClick={() => {
                  if (!isCurrent) onRestore(entry.prompt);
                }}
                aria-current={isCurrent ? 'true' : undefined}
                disabled={isCurrent}
                className={cn(
                  'w-full text-left px-2 py-1.5 rounded transition-colors',
                  isCurrent
                    ? 'bg-primary/10 border border-primary/30 cursor-default'
                    : 'hover:bg-muted',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">
                    {i === 0 ? 'Latest' : `v${arr.length - i}`}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatTimeAgo(entry.createdAt)}
                  </span>
                </div>
                <p className="text-xs font-mono mt-0.5 line-clamp-2 whitespace-pre-wrap">
                  {entry.prompt}
                </p>
                {isCurrent && (
                  <span className="text-[10px] text-primary mt-0.5 inline-block">
                    current
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
