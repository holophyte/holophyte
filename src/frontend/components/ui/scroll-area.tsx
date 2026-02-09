import { ScrollArea as RadixScrollArea } from "radix-ui";
import type React from "react";
import { cn } from "../../lib/utils";

function ScrollArea({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixScrollArea.Root>) {
  return (
    <RadixScrollArea.Root
      className={cn("relative overflow-hidden", className)}
      {...props}
    >
      <RadixScrollArea.Viewport className="h-full w-full rounded-[inherit]">
        {children}
      </RadixScrollArea.Viewport>
      <ScrollBar />
      <RadixScrollArea.Corner />
    </RadixScrollArea.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixScrollArea.Scrollbar>) {
  return (
    <RadixScrollArea.Scrollbar
      orientation={orientation}
      className={cn(
        "flex touch-none select-none transition-colors",
        orientation === "vertical" &&
          "h-full w-2.5 border-l border-l-transparent p-[1px]",
        orientation === "horizontal" &&
          "h-2.5 flex-col border-t border-t-transparent p-[1px]",
        className,
      )}
      {...props}
    >
      <RadixScrollArea.Thumb className="relative flex-1 rounded-full bg-border" />
    </RadixScrollArea.Scrollbar>
  );
}

export { ScrollArea, ScrollBar };
