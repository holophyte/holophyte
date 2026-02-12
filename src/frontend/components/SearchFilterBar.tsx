import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Search, Tag, X } from 'lucide-react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import Input from './ui/Input';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

export function SearchFilterBar() {
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const filterLabelIds = useAppStore((s) => s.filterLabelIds);
  const toggleFilterLabel = useAppStore((s) => s.toggleFilterLabel);
  const clearFilters = useAppStore((s) => s.clearFilters);

  const labels = useQuery(
    api.labels.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );
  const hasFilters = searchQuery !== '' || filterLabelIds.length > 0;

  return (
    <div className="flex items-center gap-2 flex-1 min-w-0 max-w-md">
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search tasks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 pl-8 pr-8 text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {labels && labels.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              size="sm"
              variant={filterLabelIds.length > 0 ? 'secondary' : 'ghost'}
              className="h-8 px-2"
            >
              <Tag className="h-3.5 w-3.5 mr-1" />
              {filterLabelIds.length > 0 ? filterLabelIds.length : 'Tags'}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-2" align="start">
            <div className="space-y-1">
              {labels.map((label) => (
                <button
                  key={label._id}
                  type="button"
                  onClick={() => toggleFilterLabel(label._id)}
                  className={cn(
                    'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                    filterLabelIds.includes(label._id) && 'bg-muted',
                  )}
                >
                  <span
                    className="h-3 w-3 rounded-sm shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  <span className="truncate">{label.name}</span>
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {hasFilters && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-muted-foreground"
          onClick={clearFilters}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
