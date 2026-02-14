import { api } from '@convex/_generated/api';
import { TaskStatus } from '@convex/schema';
import { Command } from 'cmdk';
import { useQuery } from 'convex/react';
import {
  ArrowRight,
  FolderGit2,
  LayoutDashboard,
  Lightbulb,
  Maximize2,
  Minimize2,
  Search,
} from 'lucide-react';
import { Dialog as RadixDialog, VisuallyHidden } from 'radix-ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { cn } from '@/frontend/lib/utils';
import { useAppStore } from '@/frontend/stores/app';

const STATUS_LABELS: Record<string, string> = {
  [TaskStatus.Backlog]: 'Backlog',
  [TaskStatus.Todo]: 'To Do',
  [TaskStatus.InProgress]: 'In Progress',
  [TaskStatus.Review]: 'Review',
  [TaskStatus.Done]: 'Done',
  [TaskStatus.Archived]: 'Archived',
};

const GROUP_HEADING_CLASS =
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground';

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  const selectRepo = useAppStore((s) => s.selectRepo);
  const selectTask = useAppStore((s) => s.selectTask);
  const selectSeedBox = useAppStore((s) => s.selectSeedBox);
  const focusMode = useAppStore((s) => s.focusMode);
  const enterFocusMode = useAppStore((s) => s.enterFocusMode);
  const exitFocusMode = useAppStore((s) => s.exitFocusMode);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);

  const tasks = useQuery(api.tasks.listAll, { includeArchived: true });
  const repos = useQuery(api.repos.list);

  const repoMap = useMemo(
    () => new Map(repos?.map((r) => [r._id, r]) ?? []),
    [repos],
  );

  // Cmd+K listener — skip when focus is inside an editable element
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        const tag = (e.target as HTMLElement).tagName;
        const isEditable =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          (e.target as HTMLElement).isContentEditable;
        if (isEditable && !open) return;
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const runAction = useCallback((fn: () => void) => {
    fn();
    setOpen(false);
  }, []);

  if (!open) return null;

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed left-1/2 top-[20%] z-50 -translate-x-1/2 w-full max-w-lg rounded-lg border bg-background shadow-2xl overflow-hidden"
      overlayClassName="fixed inset-0 z-50 bg-black/50"
    >
      <VisuallyHidden.Root asChild>
        <RadixDialog.Title>Command palette</RadixDialog.Title>
      </VisuallyHidden.Root>
      <div className="flex items-center border-b px-3">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Command.Input
          placeholder="Search tasks, projects, or actions..."
          className="flex h-11 w-full bg-transparent py-3 px-2 text-sm outline-none placeholder:text-muted-foreground"
          autoFocus
        />
      </div>
      <Command.List className="max-h-80 overflow-y-auto p-1">
        <Command.Empty className="py-6 text-center text-sm text-muted-foreground">
          No results found.
        </Command.Empty>

        {/* Navigation actions */}
        <Command.Group heading="Navigation" className={GROUP_HEADING_CLASS}>
          <CommandItem
            value="nav-all-tasks"
            onSelect={() =>
              runAction(() => {
                selectRepo(null);
                selectTask(null);
              })
            }
          >
            <LayoutDashboard className="h-4 w-4 shrink-0 text-muted-foreground" />
            All Tasks
          </CommandItem>
          <CommandItem
            value="nav-seed-box"
            onSelect={() => runAction(() => selectSeedBox())}
          >
            <Lightbulb className="h-4 w-4 shrink-0 text-muted-foreground" />
            Seed Box
          </CommandItem>
          {focusMode ? (
            <CommandItem
              value="nav-exit-focus-mode"
              onSelect={() => runAction(() => exitFocusMode())}
            >
              <Minimize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
              Exit Focus Mode
            </CommandItem>
          ) : (
            selectedTaskId && (
              <CommandItem
                value="nav-focus-mode"
                onSelect={() => runAction(() => enterFocusMode())}
              >
                <Maximize2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                Enter Focus Mode
              </CommandItem>
            )
          )}
        </Command.Group>

        {/* Projects */}
        {repos && repos.length > 0 && (
          <Command.Group heading="Projects" className={GROUP_HEADING_CLASS}>
            {repos.map((repo) => (
              <CommandItem
                key={repo._id}
                value={`${repo.name} repo-${repo._id}`}
                onSelect={() =>
                  runAction(() => {
                    selectRepo(repo._id);
                    selectTask(null);
                  })
                }
              >
                <FolderGit2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                {repo.name}
              </CommandItem>
            ))}
          </Command.Group>
        )}

        {/* Tasks */}
        {tasks && tasks.length > 0 && (
          <Command.Group heading="Tasks" className={GROUP_HEADING_CLASS}>
            {tasks.map((task) => (
              <CommandItem
                key={task._id}
                value={`${task.title} task-${task._id}`}
                onSelect={() =>
                  runAction(() => {
                    selectRepo(task.repoId);
                    selectTask(task._id);
                  })
                }
              >
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate">{task.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {STATUS_LABELS[task.status] ?? task.status}
                </span>
                {repoMap.get(task.repoId) && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">
                    {repoMap.get(task.repoId)?.name}
                  </span>
                )}
              </CommandItem>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}

interface CommandItemProps {
  children: React.ReactNode;
  value: string;
  onSelect: () => void;
}

function CommandItem({ children, value, onSelect }: CommandItemProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-2 text-sm cursor-pointer',
        'aria-selected:bg-accent aria-selected:text-accent-foreground',
      )}
    >
      {children}
    </Command.Item>
  );
}
