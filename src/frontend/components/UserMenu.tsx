import { api } from '@convex/_generated/api';
import { useAuthActions } from '@convex-dev/auth/react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from 'convex/react';
import { KeyRound, LogOut } from 'lucide-react';
import { useAppStore } from '@/frontend/stores/app';
import { ThemeSwitcher } from './ThemeSwitcher';
import Avatar from './ui/Avatar';
import Button from './ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/Popover';

export default function UserMenu() {
  const authActions = useAuthActions();
  const navigate = useNavigate();
  const user = useQuery(api.users.viewer);
  const clearOrgSelection = useAppStore((s) => s.clearOrgSelection);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm hover:bg-muted/50 transition-colors whitespace-nowrap"
          aria-label={user?.name ? `User menu for ${user.name}` : 'User menu'}
        >
          <Avatar
            src={user?.image}
            name={user?.name}
            className="h-6 w-6 text-[10px] shrink-0"
          />
          <span className="truncate flex-1 text-left">
            {user?.name ?? 'Loading...'}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start" side="top">
        <div className="px-2 py-1.5 text-sm">
          <p className="font-medium truncate">{user?.name}</p>
          {user?.email && (
            <p className="text-xs text-muted-foreground truncate">
              {user.email}
            </p>
          )}
        </div>
        <div className="border-t my-1" />
        <div className="px-1 py-1.5">
          <ThemeSwitcher />
        </div>
        <div className="border-t my-1" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-sm"
          onClick={() => void navigate({ to: '/settings' })}
        >
          <KeyRound className="h-4 w-4" />
          API Keys
        </Button>
        <div className="border-t my-1" />
        {authActions && (
          <Button
            variant="ghost"
            className="w-full justify-start gap-2 text-sm"
            onClick={() => {
              clearOrgSelection();
              void authActions.signOut();
            }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
