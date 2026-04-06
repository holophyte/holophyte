import { TriangleAlert } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { FallbackProps } from 'react-error-boundary';
import Button from './Button';

/** Full-page last-resort error fallback. */
function RootErrorFallback({ error }: FallbackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    containerRef.current?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-8 outline-none"
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
      <Button variant="outline" onClick={() => window.location.reload()}>
        Reload page
      </Button>
    </div>
  );
}

export default RootErrorFallback;
