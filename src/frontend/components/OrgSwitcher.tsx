import { api } from '@convex/_generated/api';
import { useQuery } from 'convex/react';
import { Building2, Check, ChevronsUpDown } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

interface OrgSwitcherProps {
  collapsed?: boolean;
}

export default function OrgSwitcher({ collapsed }: OrgSwitcherProps) {
  const orgs = useQuery(api.organizations.listByUser);
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const setSelectedOrgId = useAppStore((s) => s.setSelectedOrgId);

  // Derive the effective org ID synchronously — no render flash
  const effectiveOrgId =
    orgs && selectedOrgId && orgs.some((o) => o._id === selectedOrgId)
      ? selectedOrgId
      : (orgs?.[0]?._id ?? null);

  // Sync the Zustand store when derived value differs (external system sync)
  useEffect(() => {
    if (effectiveOrgId && effectiveOrgId !== selectedOrgId) {
      setSelectedOrgId(effectiveOrgId);
    }
  }, [effectiveOrgId, selectedOrgId, setSelectedOrgId]);

  const selectedOrg = orgs?.find((o) => o._id === effectiveOrgId);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'w-full gap-2 text-sm',
            collapsed ? 'justify-center px-0' : 'justify-between px-2',
          )}
          aria-label={
            selectedOrg
              ? `Current organization: ${selectedOrg.name}`
              : 'Select organization'
          }
        >
          <div className="flex items-center gap-2 min-w-0">
            <Building2
              className="h-4 w-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            {!collapsed && (
              <span className="truncate">
                {selectedOrg?.name ?? 'Select org...'}
              </span>
            )}
          </div>
          {!collapsed && (
            <ChevronsUpDown
              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1" align="start">
        <div className="space-y-0.5" role="menu" aria-label="Organizations">
          {orgs?.map((org) => (
            <button
              key={org._id}
              type="button"
              role="menuitemradio"
              aria-checked={effectiveOrgId === org._id}
              onClick={() => setSelectedOrgId(org._id)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-muted/50 transition-colors text-left',
                effectiveOrgId === org._id && 'bg-muted',
              )}
            >
              <Building2
                className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="truncate flex-1">{org.name}</span>
              {org.personal && (
                <span className="text-[10px] text-muted-foreground">
                  Personal
                </span>
              )}
              {effectiveOrgId === org._id && (
                <Check
                  className="h-3.5 w-3.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
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
