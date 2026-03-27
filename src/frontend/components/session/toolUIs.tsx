import { makeAssistantToolUI } from '@assistant-ui/react';
import { useState } from 'react';
import { toolIcon, toolSummary } from '@/frontend/lib/toolDisplay';
import { cn } from '@/frontend/lib/utils';
import ApprovalButtons from './ApprovalButtons';
import { useSessionActions } from './SessionActionsContext';

const MAX_RESULT_CHARS = 2000;

interface ToolCallDisplayProps {
  toolName: string;
  toolCallId: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

function ToolCallDisplay({
  toolName,
  toolCallId,
  args,
  result,
  isError,
}: ToolCallDisplayProps) {
  const { pendingApprovals } = useSessionActions();
  const [expanded, setExpanded] = useState(false);
  const [showFullResult, setShowFullResult] = useState(false);

  const pending = pendingApprovals.find(
    (a) => a.requestId === toolCallId && !a.resolved,
  );

  const resultStr =
    result !== undefined
      ? typeof result === 'string'
        ? result
        : JSON.stringify(result, null, 2)
      : undefined;

  const truncatedResult =
    resultStr && resultStr.length > MAX_RESULT_CHARS && !showFullResult
      ? `${resultStr.slice(0, MAX_RESULT_CHARS)}…`
      : resultStr;

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
        <span className="truncate text-muted-foreground/80">
          {toolSummary(toolName, args)}
        </span>
        {pending && (
          <span className="ml-2 shrink-0 text-amber-500 text-[10px] font-medium">
            Needs approval
          </span>
        )}
        <span className="ml-auto text-muted-foreground/50 shrink-0">
          {expanded ? '▲' : '▼'}
        </span>
      </button>

      {pending && (
        <div className="px-3 py-2 border-t border-border/50">
          <ApprovalButtons requestId={toolCallId} />
        </div>
      )}

      {expanded && (
        <div className="px-3 pb-2 space-y-2 border-t border-border/50">
          <div className="mt-2">
            <p className="text-muted-foreground/70 uppercase tracking-wide text-[10px] mb-1 font-medium">
              Input
            </p>
            <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {resultStr !== undefined && (
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
              {resultStr.length > MAX_RESULT_CHARS && (
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

type ToolRenderProps = {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
};

function makeToolUI(toolName: string) {
  return makeAssistantToolUI<Record<string, unknown>, unknown>({
    toolName,
    render: ({ toolCallId, args, result, isError }) => (
      <ToolCallDisplay
        toolName={toolName}
        toolCallId={toolCallId}
        args={args}
        result={result}
        isError={isError}
      />
    ),
  });
}

export const BashToolUI = makeToolUI('Bash');
export const ReadToolUI = makeToolUI('Read');
export const EditToolUI = makeToolUI('Edit');
export const WriteToolUI = makeToolUI('Write');
export const GlobToolUI = makeToolUI('Glob');
export const GrepToolUI = makeToolUI('Grep');
export const WebFetchToolUI = makeToolUI('WebFetch');
export const WebSearchToolUI = makeToolUI('WebSearch');

/**
 * Fallback component for tool-call parts not matched by a registered tool UI.
 * Passed as `tools.Fallback` to `MessagePrimitive.Content` in
 * `CustomAssistantMessage` so that ANY tool call renders — the
 * `makeAssistantToolUI({ toolName: '*' })` approach only registers a literal
 * `"*"` key and doesn't act as a wildcard.
 */
export function ToolCallFallback({
  toolCallId,
  toolName,
  args,
  result,
  isError,
}: ToolRenderProps) {
  return (
    <ToolCallDisplay
      toolName={toolName}
      toolCallId={toolCallId}
      args={args}
      result={result}
      isError={isError}
    />
  );
}
