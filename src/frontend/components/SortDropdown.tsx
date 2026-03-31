import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calendar,
  Check,
  Flag,
  GripVertical,
} from 'lucide-react';
import { useState } from 'react';
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
];

interface SortDropdownProps {
  value: SortPreference;
  onChange: (pref: SortPreference) => void;
}

export default function SortDropdown({ value, onChange }: SortDropdownProps) {
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
          aria-label="Sort tasks"
        >
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{current?.label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="end">
        <div role="listbox" aria-label="Sort order" className="space-y-0.5">
          {SORT_OPTIONS.map((option) => {
            const Icon = option.icon;
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isActive}
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
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
