import { useEffect, useRef } from 'react';
import type { ProjectCommand } from '@/frontend/hooks/useSession';

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
      role="listbox"
      className="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-y-auto overscroll-contain rounded-md border border-border bg-popover shadow-lg z-10"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          className={`flex w-full items-center gap-2 px-2.5 py-1 text-xs cursor-pointer ${
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-popover-foreground hover:bg-accent/50'
          }`}
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
        </button>
      ))}
    </div>
  );
}

/**
 * Returns the filtered command list for a given input and filter.
 * Exported for use in keyboard navigation logic.
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
