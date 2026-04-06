import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import Button from './Button';

/** Panel-level error fallback — fills its container with a retry option. */
function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="h-full w-full flex flex-col items-center justify-center gap-3 bg-destructive/5 rounded-md p-4 outline-none"
      role="alert"
    >
      <TriangleAlert className="h-6 w-6 text-destructive" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-destructive">
        Something went wrong
      </h2>
      <p className="text-xs text-muted-foreground font-mono max-w-xs line-clamp-3 text-center">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <Button variant="outline" size="sm" onClick={resetErrorBoundary}>
        Try again
      </Button>
    </div>
  );
}

export default ErrorFallback;
