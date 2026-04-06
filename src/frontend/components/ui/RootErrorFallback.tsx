import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FallbackProps } from 'react-error-boundary';

/** Full-page last-resort error fallback — dependency-light to avoid cascading failures. */
function RootErrorFallback({ error }: FallbackProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  return (
    <div
      className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-8"
      role="alert"
    >
      <TriangleAlert
        className="h-10 w-10 text-destructive"
        aria-hidden="true"
      />
      <h1 className="text-lg font-semibold text-destructive">
        Something went wrong
      </h1>
      <p className="text-sm text-muted-foreground font-mono max-w-md line-clamp-3 text-center">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <button
        ref={buttonRef}
        type="button"
        className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
        onClick={() => window.location.reload()}
      >
        Reload page
      </button>
    </div>
  );
}

export default RootErrorFallback;
