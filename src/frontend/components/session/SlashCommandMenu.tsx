import { useEffect, useRef } from 'react';

interface SlashCommandMenuProps {
  /** All available command names (without leading slash). */
  commands: string[];
  /** The text after the leading `/` used to filter commands. */
  filter: string;
  /** Index of the currently highlighted item. */
  selectedIndex: number;
  /** Called when the user selects a command (Tab, Enter, or click). */
  onSelect: (command: string) => void;
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
      className="absolute bottom-full left-0 right-0 mb-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover shadow-lg z-10"
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          className={`flex w-full items-center px-3 py-1.5 text-sm cursor-pointer ${
            i === selectedIndex
              ? 'bg-accent text-accent-foreground'
              : 'text-popover-foreground hover:bg-accent/50'
          }`}
          onMouseDown={(e) => {
            // Prevent blur on the textarea
            e.preventDefault();
            onSelect(cmd);
          }}
        >
          <span className="font-mono text-muted-foreground">/{cmd}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * Returns the filtered command list for a given input and filter.
 * Exported for use in keyboard navigation logic.
 */
export function filterCommands(commands: string[], filter: string): string[] {
  return commands.filter((cmd) =>
    cmd.toLowerCase().startsWith(filter.toLowerCase()),
  );
}
