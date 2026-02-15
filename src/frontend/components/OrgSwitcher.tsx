import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

export default function OrgSwitcher() {
  const orgs = useQuery(api.organizations.listByUser);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const setSelectedOrgId = useAppStore((s) => s.setSelectedOrgId);

  // Auto-select the first org, or reset if selected org is no longer valid
  useEffect(() => {
    if (!orgs || orgs.length === 0) return;
    const stillValid =
      selectedOrgId && orgs.some((o) => o._id === selectedOrgId);
    if (!stillValid && orgs[0]) {
      setSelectedOrgId(orgs[0]._id);
    }
  }, [selectedOrgId, orgs, setSelectedOrgId]);

  const selectedOrg = orgs?.find((o) => o._id === selectedOrgId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className="w-full justify-between gap-2 text-sm px-2"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {selectedOrg?.name ?? 'Select org...'}
            </span>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="space-y-0.5">
          {orgs?.map((org) => (
            <button
              key={org._id}
              type="button"
              onClick={() => setSelectedOrgId(org._id)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                selectedOrgId === org._id && 'bg-muted',
              )}
            >
              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{org.name}</span>
              {org.personal && (
                <span className="text-[10px] text-muted-foreground">
                  Personal
                </span>
              )}
              {selectedOrgId === org._id && (
                <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </button>
          ))}
          {(!orgs || orgs.length === 0) && (
            <p className="text-xs text-muted-foreground px-2 py-3 text-center">
              No organizations
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
