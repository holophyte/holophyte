import { useEffect, useRef } from 'react';
import type { ProjectCommand } from '@/frontend/hooks/useSession';
import { cn } from '@/frontend/lib/utils';

interface SlashCommandMenuProps {
  /** All available commands (without leading slash). */
  commands: ProjectCommand[];
  /** The text after the leading `/` used to filter commands. */
  filter: string;
  /** Index of the currently highlighted item. */
  selectedIndex: number;
  /** Called when the user selects a command (Tab, Enter, or click). */
  onSelect: (name: string) => void;
}

export default function SlashCommandMenu({
  commands,
  filter,
  selectedIndex,
  onSelect,
}: SlashCommandMenuProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const filtered = filterCommands(commands, filter);

  // Scroll the selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div
      ref={listRef}
      id="slash-command-menu"
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-32 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-lg z-10"
    >
      {filtered.map((cmd, i) => (
        <div
          key={cmd.name}
          id={`slash-cmd-${cmd.name}`}
          role="option"
          tabIndex={-1}
          aria-selected={i === selectedIndex}
          className={cn(
            'flex w-full items-center gap-2 px-2.5 py-1 text-xs cursor-pointer',
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-popover-foreground hover:bg-accent/50',
          )}
          onMouseDown={(e) => {
            // Prevent blur on the textarea when clicking a command
            e.preventDefault();
            onSelect(cmd.name);
          }}
        >
          <span className="shrink-0 font-mono text-muted-foreground">
            /{cmd.name}
          </span>
          {cmd.description && (
            <span className="truncate text-muted-foreground/70">
              {cmd.description}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Returns commands whose names start with `filter` (case-insensitive).
 * Exported so `SessionComposer` can use the same filtering logic for
 * keyboard navigation without duplicating the predicate.
 *
 * @param commands - The full list of available commands.
 * @param filter - The text typed after the leading `/`; empty string returns all commands.
 * @returns The subset of `commands` matching the prefix.
 */
export function filterCommands(
  commands: ProjectCommand[],
  filter: string,
): ProjectCommand[] {
  const lowerFilter = filter.toLowerCase();
  return commands.filter((cmd) =>
    cmd.name?.toLowerCase().startsWith(lowerFilter),
  );
}
