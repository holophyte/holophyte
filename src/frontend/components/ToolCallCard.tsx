import {
  FileEdit,
  FileSearch,
  FileText,
  Globe,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/frontend/lib/utils';

/** Props for {@link ToolCallCard}. */
interface ToolCallCardProps {
  /** Name of the Claude tool that was called (e.g. `"Bash"`, `"Read"`, `"Edit"`). */
  toolName: string;
  /** Raw tool input parameters as received from the SDK. */
  input: Record<string, unknown>;
  /** Tool result text, if available. Shown in the expanded view. */
  result?: string;
  /** When `true`, renders the result with an error style (red background). */
  isError?: boolean;
}

function toolIcon(name: string) {
  switch (name) {
    case 'Read':
      return <FileText className="h-3.5 w-3.5" />;
    case 'Edit':
      return <FileEdit className="h-3.5 w-3.5" />;
    case 'Write':
      return <FileEdit className="h-3.5 w-3.5" />;
    case 'Bash':
      return <Terminal className="h-3.5 w-3.5" />;
    case 'Grep':
      return <Search className="h-3.5 w-3.5" />;
    case 'Glob':
      return <FileSearch className="h-3.5 w-3.5" />;
    case 'WebFetch':
    case 'WebSearch':
      return <Globe className="h-3.5 w-3.5" />;
    default:
      return <Wrench className="h-3.5 w-3.5" />;
  }
}

function toolSummary(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'Read': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Read file';
    }
    case 'Edit': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Edit file';
    }
    case 'Write': {
      const path = typeof input.file_path === 'string' ? input.file_path : '';
      return path || 'Write file';
    }
    case 'Bash': {
      const cmd = typeof input.command === 'string' ? input.command : '';
      return cmd.length > 80 ? `${cmd.slice(0, 80)}…` : cmd || 'bash command';
    }
    case 'Grep': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      const path = typeof input.path === 'string' ? ` in ${input.path}` : '';
      return `${pattern}${path}` || 'Search';
    }
    case 'Glob': {
      const pattern = typeof input.pattern === 'string' ? input.pattern : '';
      return pattern || 'Glob pattern';
    }
    case 'WebFetch':
    case 'WebSearch': {
      const url =
        typeof input.url === 'string'
          ? input.url
          : typeof input.query === 'string'
            ? input.query
            : '';
      return url.length > 80 ? `${url.slice(0, 80)}…` : url || name;
    }
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

const MAX_RESULT_CHARS = 2000;

/**
 * Collapsible card that displays a single Claude tool call inline in the
 * message stream. Collapsed by default to reduce noise; expands to show full
 * input parameters and (if available) the tool result or error.
 *
 * Results longer than 2000 characters are truncated with a "Show more" toggle.
 *
 * @example
 * ```tsx
 * <ToolCallCard
 *   toolName="Bash"
 *   input={{ command: 'bun run test' }}
 *   result="All tests passed"
 * />
 * ```
 */
export default function ToolCallCard({
  toolName,
  input,
  result,
  isError,
}: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);

  const summary = toolSummary(toolName, input);
  const truncatedResult =
    result && result.length > MAX_RESULT_CHARS && !showFullResult
      ? `${result.slice(0, MAX_RESULT_CHARS)}…`
      : result;

  return (
    <div
      className={cn(
        'my-1 rounded border-l-2 bg-muted/40 text-xs',
        isError ? 'border-l-destructive' : 'border-l-border',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/60 transition-colors"
      >
        <span className="text-muted-foreground shrink-0">
          {toolIcon(toolName)}
        </span>
        <span className="font-mono font-medium text-muted-foreground shrink-0">
          {toolName}
        </span>
        <span className="truncate text-muted-foreground/80">{summary}</span>
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border/50">
          <div className="mt-2">
            <p className="text-muted-foreground/70 uppercase tracking-wide text-[10px] mb-1 font-medium">
              Input
            </p>
            <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>

          {result !== undefined && (
            <div>
              <p className="text-muted-foreground/70 uppercase tracking-wide text-[10px] mb-1 font-medium">
                {isError ? 'Error' : 'Result'}
              </p>
              <pre
                className={cn(
                  'overflow-x-auto rounded p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words',
                  isError
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-muted/60',
                )}
              >
                {truncatedResult}
              </pre>
              {result.length > MAX_RESULT_CHARS && (
                <button
                  type="button"
                  onClick={() => setShowFullResult((v) => !v)}
                  className="mt-1 text-primary/70 hover:text-primary text-[10px] underline underline-offset-2"
                >
                  {showFullResult ? 'Show less' : 'Show more'}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
