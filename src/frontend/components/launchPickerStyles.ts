/**
 * Shared SelectTrigger class string for the launch-row pickers
 * (EffortPicker, PermissionModePicker). Mirrors ProviderModelPicker's
 * plain `<button>` styling so all three pickers look identical.
 *
 * Descendant selectors override SelectTrigger's built-in chevron
 * (size-4 opacity-50) to the smaller muted variant. The `h-auto!`
 * important override is needed to defeat SelectTrigger's default `h-9`.
 */
export const LAUNCH_PICKER_TRIGGER_CLASS =
  'h-auto! gap-1.5 rounded border-input bg-background px-2 py-1 text-xs font-medium leading-4 text-foreground shadow-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:border-input focus-visible:ring-1 focus-visible:ring-ring [&_svg]:size-3 [&_svg]:text-muted-foreground [&_svg]:opacity-100';
