import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { useMatch, useNavigate, useParams } from '@tanstack/react-router';
import { useMutation, useQuery } from 'convex/react';
import {
  Eye,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Sprout,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { isEditableElement } from '@/frontend/lib/dom';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';
import { AddRepoDialog } from './AddRepoDialog';
import CompanionStatus from './CompanionStatus';
import HolophyteIcon from './icons/HolophyteIcon';
import OrgSwitcher from './OrgSwitcher';
import UserMenu from './UserMenu';
import Button from './ui/Button';
import PageHeader from './ui/PageHeader';
import ScrollArea from './ui/ScrollArea';
import Separator from './ui/Separator';
import Skeleton from './ui/Skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from './ui/Tooltip';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

interface SidebarTooltipProps {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
}

/** Wraps a button with a tooltip that only renders when the sidebar is collapsed. */
function SidebarTooltip({ label, collapsed, children }: SidebarTooltipProps) {
  if (!collapsed) return children;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar() {
  const selectedOrgId = useAppStore((s) => s.selectedOrgId);
  const collapsed = useAppStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const repos = useQuery(
    api.repos.list,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );
  const activeTasks = useQuery(
    api.tasks.listActive,
    selectedOrgId ? { orgId: selectedOrgId } : 'skip',
  );
  const removeRepo = useMutation(api.repos.remove);
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const selectedRepoId = (params.repoId as Id<'repos'> | undefined) ?? null;
  const selectedTaskId = (params.taskId as Id<'tasks'> | undefined) ?? null;
  const homeMatch = useMatch({ from: '/', shouldThrow: false });
  const seedsMatch = useMatch({ from: '/seeds', shouldThrow: false });
  const [addRepoOpen, setAddRepoOpen] = useState(false);

  // Cmd+B / Ctrl+B keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isEditableElement(e.target)) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toggleSidebar]);

  const handleRemove = async (e: React.MouseEvent, repoId: Id<'repos'>) => {
    e.stopPropagation();
    if (selectedRepoId === repoId) {
      void navigate({ to: '/' });
    }
    await removeRepo({ id: repoId });
  };

  // Group active tasks by repo
  const activeTasksByRepo = new Map<string, typeof activeTasks>();
  for (const task of activeTasks ?? []) {
    const repoId = String(task.repoId);
    const existing = activeTasksByRepo.get(repoId) ?? [];
    existing.push(task);
    activeTasksByRepo.set(repoId, existing);
  }

  return (
    <TooltipProvider>
      <aside
        className={cn(
          'border-r bg-muted/30 flex flex-col transition-[width] duration-300 ease-in-out motion-reduce:transition-none overflow-hidden shrink-0 [&_*]:min-w-0',
          collapsed ? 'w-12' : 'w-64',
        )}
        aria-label="Navigation"
      >
        {/* Header */}
        <PageHeader
          data-testid="sidebar-header"
          className="gap-2 font-semibold text-lg whitespace-nowrap pl-2 pr-4 overflow-hidden"
        >
          <button
            type="button"
            className="shrink-0 cursor-pointer"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            data-testid="sidebar-brand-toggle"
          >
            <HolophyteIcon
              className="h-5 w-auto shrink-0 text-primary"
              aria-hidden="true"
            />
          </button>
          <span className="flex-1 truncate">Holophyte</span>
          <SidebarTooltip
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            collapsed={collapsed}
          >
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={toggleSidebar}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              data-testid="sidebar-toggle"
            >
              {collapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </Button>
          </SidebarTooltip>
        </PageHeader>

        {/* Org switcher */}
        <div className="py-1">
          <OrgSwitcher />
        </div>
        <Separator />

        {/* Nav buttons — no container padding; buttons have px-4 which centers icons in 48px */}
        <div className="py-2 space-y-1">
          <SidebarTooltip label="All Tasks" collapsed={collapsed}>
            <Button
              variant={homeMatch ? 'secondary' : 'ghost'}
              className="w-full justify-start gap-2 whitespace-nowrap overflow-hidden"
              onClick={() => void navigate({ to: '/' })}
              aria-label="All Tasks"
            >
              <LayoutDashboard className="h-4 w-4 shrink-0" />
              <span className="truncate">All Tasks</span>
            </Button>
          </SidebarTooltip>
          <SidebarTooltip label="Seed Box" collapsed={collapsed}>
            <Button
              variant={seedsMatch ? 'secondary' : 'ghost'}
              className="w-full justify-start gap-2 whitespace-nowrap overflow-hidden"
              onClick={() => void navigate({ to: '/seeds' })}
              aria-label="Seed Box"
            >
              <Lightbulb className="h-4 w-4 shrink-0" />
              <span className="truncate">Seed Box</span>
            </Button>
          </SidebarTooltip>
        </div>

        <Separator />

        {/* Projects header */}
        {!collapsed && (
          <div className="flex items-center justify-between px-4 py-2 whitespace-nowrap">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Projects
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setAddRepoOpen(true)}
              aria-label="Add project"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <ScrollArea className="flex-1 [&>div>div]:!block">
          <div className="py-2 space-y-1">
            {repos === undefined &&
              [1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2">
                  <Skeleton className="h-4 w-4 shrink-0 rounded" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              ))}
            {repos?.map((repo) => {
              const repoActiveTasks =
                activeTasksByRepo.get(String(repo._id)) ?? [];
              return (
                <div key={repo._id}>
                  <div className="group relative">
                    <SidebarTooltip label={repo.name} collapsed={collapsed}>
                      <Button
                        variant={
                          selectedRepoId === repo._id ? 'secondary' : 'ghost'
                        }
                        className="w-full justify-start gap-2 text-sm pr-8 whitespace-nowrap overflow-hidden"
                        onClick={() =>
                          void navigate({
                            to: '/repos/$repoId',
                            params: { repoId: repo._id },
                          })
                        }
                        aria-label={repo.name}
                      >
                        <FolderGit2 className="h-4 w-4 shrink-0" />
                        <span className="truncate">{repo.name}</span>
                      </Button>
                    </SidebarTooltip>
                    {!collapsed && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        onClick={(e) => handleRemove(e, repo._id)}
                        aria-label={`Delete ${repo.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  {!collapsed && repoActiveTasks.length > 0 && (
                    <div className="ml-4 pl-2 border-l border-border/50 space-y-0.5 my-0.5">
                      {repoActiveTasks.map((task) => (
                        <button
                          key={task._id}
                          type="button"
                          onClick={() =>
                            void navigate({
                              to: '/repos/$repoId/tasks/$taskId/page',
                              params: {
                                repoId: String(task.repoId),
                                taskId: task._id,
                              },
                            })
                          }
                          className={cn(
                            'w-full min-w-0 cursor-pointer text-left rounded-md px-2 py-1 transition-colors flex items-center gap-1.5',
                            selectedTaskId === task._id
                              ? 'bg-accent'
                              : 'hover:bg-accent/50',
                          )}
                        >
                          {task.status === TaskStatus.InProgress ? (
                            <Sprout
                              className={cn(
                                'h-3 w-3 shrink-0 text-green-500',
                                task.hasRunningSession && 'animate-pulse',
                              )}
                              aria-label={
                                task.hasRunningSession
                                  ? 'Running session'
                                  : 'In progress'
                              }
                            />
                          ) : (
                            <Eye
                              className="h-3 w-3 shrink-0 text-amber-500"
                              aria-label="In review"
                            />
                          )}
                          <span className="truncate text-xs text-muted-foreground">
                            {task.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {repos?.length === 0 && !collapsed && (
              <p className="text-xs text-muted-foreground px-2 py-4 text-center">
                No projects added yet.
                <br />
                Click + to add one.
              </p>
            )}
          </div>
        </ScrollArea>

        <Separator />

        {/* Command palette hint */}
        {!collapsed && (
          <>
            <div className="flex items-center justify-center px-2 py-1.5">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                  {isMac ? '⌘K' : 'Ctrl+K'}
                </kbd>{' '}
                Command palette
              </span>
            </div>
            <Separator />
          </>
        )}
        <CompanionStatus />
        <Separator />

        {/* User menu */}
        <div className="py-2">
          <UserMenu />
        </div>

        <AddRepoDialog open={addRepoOpen} onOpenChange={setAddRepoOpen} />
      </aside>
    </TooltipProvider>
  );
}
