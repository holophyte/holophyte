import type { Doc } from '@convex/_generated/dataModel';
import { cn } from '@/frontend/lib/utils';

export type SessionStatus = Doc<'sessions'>['status'];

interface SessionStatusDotProps {
  /** Session lifecycle status that determines the dot color. */
  status: SessionStatus;
  /** Additional CSS classes forwarded to the dot element. */
  className?: string;
}

/**
 * A small colored dot that communicates session status at a glance.
 *
 * | Status | Color | Animation |
 * |--------|-------|-----------|
 * | `queued` | yellow | pulsing |
 * | `running` | green | pulsing |
 * | `idle` | gray | none |
 * | `failed` | red | none |
 *
 * Rendered as an `aria-hidden` decorative element — pair it with an accessible
 * label on the parent if the status information must be conveyed to screen
 * readers (e.g. `aria-label="Session running"` on the container).
 *
 * @example
 * ```tsx
 * <SessionStatusDot status="queued" />
 * <SessionStatusDot status="running" />
 * <SessionStatusDot status="idle" />
 * ```
 */
export default function SessionStatusDot({
  status,
  className,
}: SessionStatusDotProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'h-2 w-2 shrink-0 rounded-full',
        status === 'queued' && 'bg-yellow-400 animate-pulse',
        status === 'running' && 'bg-green-500 animate-pulse',
        status === 'idle' && 'bg-gray-400',
        status === 'failed' && 'bg-red-500',
        className,
      )}
    />
  );
}
