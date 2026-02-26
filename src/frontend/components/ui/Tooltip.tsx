import { Tooltip as RadixTooltip } from 'radix-ui';
import { cn } from '../../lib/utils';

function TooltipProvider({
  children,
  ...props
}: RadixTooltip.TooltipProviderProps) {
  return (
    <RadixTooltip.Provider delayDuration={100} {...props}>
      {children}
    </RadixTooltip.Provider>
  );
}

function Tooltip({ ...props }: RadixTooltip.TooltipProps) {
  return <RadixTooltip.Root {...props} />;
}

function TooltipTrigger({ ...props }: RadixTooltip.TooltipTriggerProps) {
  return <RadixTooltip.Trigger {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: RadixTooltip.TooltipContentProps) {
  return (
    <RadixTooltip.Portal>
      <RadixTooltip.Content
        sideOffset={sideOffset}
        className={cn(
          'z-50 max-w-xs rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
          className,
        )}
        {...props}
      />
    </RadixTooltip.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
