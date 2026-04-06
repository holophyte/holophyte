import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FallbackProps } from 'react-error-boundary';

/** Panel-level error fallback — fills its container with a retry option. */
function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      className="h-full w-full flex flex-col items-center justify-center gap-3 bg-destructive/5 rounded-md p-4"
      role="alert"
    >
      <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-destructive">
        Something went wrong
      </h2>
      <p className="text-xs text-muted-foreground font-mono max-w-xs line-clamp-3 text-center">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
        onClick={resetErrorBoundary}
      >
        Try again
      </button>
    </div>
  );
}

export default ErrorFallback;
