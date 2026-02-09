import { Label as RadixLabel } from "radix-ui";
import type React from "react";
import { cn } from "../../lib/utils";

function Label({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixLabel.Root>) {
  return (
    <RadixLabel.Root
      className={cn(
        "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
