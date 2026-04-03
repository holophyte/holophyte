import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  Flag,
  GripVertical,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Fragment, useState } from 'react';
import type { SortPreference } from '@/frontend/lib/taskSort';
import { cn } from '@/frontend/lib/utils';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

const SORT_OPTIONS: {
  value: SortPreference;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { value: 'manual', label: 'Manual', icon: GripVertical },
  { value: 'priority', label: 'Priority', icon: Flag },
  { value: 'dueDate', label: 'Due date', icon: Calendar },
  { value: 'newest', label: 'Newest first', icon: ArrowDown },
  { value: 'oldest', label: 'Oldest first', icon: ArrowUp },
  { value: 'auto', label: 'Auto sort', icon: Sparkles },
];

interface SortDropdownProps {
  value: SortPreference;
  onChange: (pref: SortPreference) => void;
  onRefreshAutoSort?: () => void;
  autoSortLoading?: boolean;
}

export default function SortDropdown({
  value,
  onChange,
  onRefreshAutoSort,
  autoSortLoading,
}: SortDropdownProps) {
  const [open, setOpen] = useState(false);

  const current =
    SORT_OPTIONS.find((o) => o.value === value) ?? SORT_OPTIONS[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 gap-1.5"
          aria-label={
            value === 'auto' ? 'Sort tasks — AI auto sort active' : 'Sort tasks'
          }
        >
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{current?.label}</span>
          {value === 'auto' && (
            <span className="text-[10px] font-semibold bg-primary/10 text-primary rounded px-1">
              AI
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="end">
        <div role="menu" aria-label="Sort order" className="space-y-0.5">
          {SORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = option.value === value;
            return (
              <Fragment key={option.value}>
                {option.value === 'auto' && (
                  <div role="none" className="border-t my-1" />
                )}
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={isActive}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                    isActive && 'bg-muted',
                  )}
                >
                  <Icon
                    className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                    aria-hidden="true"
                  />
                  <span className="flex-1">{option.label}</span>
                  {isActive && (
                    <Check
                      className="h-3.5 w-3.5 text-primary shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </Fragment>
            );
          })}
        </div>
        {value === 'auto' && (
          <>
            <div role="none" className="border-t my-1" />
            <button
              type="button"
              disabled={autoSortLoading}
              aria-label={
                autoSortLoading ? 'Sorting in progress' : 'Refresh auto sort'
              }
              onClick={() => {
                onRefreshAutoSort?.();
                setOpen(false);
              }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left disabled:opacity-50"
            >
              {autoSortLoading ? (
                <Loader2
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0 animate-spin"
                  aria-hidden="true"
                />
              ) : (
                <RefreshCw
                  className="h-3.5 w-3.5 text-muted-foreground shrink-0"
                  aria-hidden="true"
                />
              )}
              <span>{autoSortLoading ? 'Sorting...' : 'Refresh sort'}</span>
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
