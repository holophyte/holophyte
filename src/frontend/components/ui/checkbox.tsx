import { Checkbox as RadixCheckbox } from "radix-ui";
import type React from "react";
import { Check } from "lucide-react";
import { cn } from "../../lib/utils";

function Checkbox({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof RadixCheckbox.Root>) {
  return (
    <RadixCheckbox.Root
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow-sm",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <RadixCheckbox.Indicator className="flex items-center justify-center">
        <Check className="h-3 w-3" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
}

export { Checkbox };
