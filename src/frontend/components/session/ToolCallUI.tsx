import type { DynamicToolUIPart } from 'ai';
import { useEffect, useState } from 'react';
import {
  Confirmation,
  ConfirmationAccepted,
  ConfirmationAction,
  ConfirmationActions,
  ConfirmationRejected,
  ConfirmationRequest,
} from '@/frontend/components/ai-elements/confirmation';
import { Terminal } from '@/frontend/components/ai-elements/terminal';
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from '@/frontend/components/ai-elements/tool';
import Button from '@/frontend/components/ui/Button';
import { toolSummary } from '@/frontend/lib/toolDisplay';
import { useSessionActions } from './SessionActionsContext';

interface ToolCallUIProps {
  part: DynamicToolUIPart;
}

const BASH_TOOLS = new Set(['Bash']);

/**
 * Codex-side approval metadata threaded onto a `dynamic-tool` part by
 * `sdkToUIMessages`. `tool` is the Codex method (e.g.
 * `'codex.item/commandExecution/requestApproval'`); `input` is the
 * request's `rawParams` payload (shape varies by method and by Codex
 * version, hence the `Record<string, unknown>`).
 */
interface CodexApprovalMarker {
  tool: string;
  input: Record<string, unknown>;
}

/**
 * Pull the Codex approval marker off a `dynamic-tool` part if present.
 * Bridge-routed Codex approvals carry `approval.codex = { tool, input }`
 * (see `sdkToUIMessages.ts`). Returns `null` for SDK / non-Codex parts.
 */
function getCodexApproval(part: DynamicToolUIPart): CodexApprovalMarker | null {
  if (
    part.state !== 'approval-requested' &&
    part.state !== 'approval-responded' &&
    part.state !== 'output-denied'
  ) {
    return null;
  }
  const approval = (part as { approval?: unknown }).approval;
  if (!approval || typeof approval !== 'object') return null;
  const codex = (approval as { codex?: unknown }).codex;
  if (!codex || typeof codex !== 'object') return null;
  const c = codex as { tool?: unknown; input?: unknown };
  if (typeof c.tool !== 'string') return null;
  return {
    tool: c.tool,
    input: (c.input ?? {}) as Record<string, unknown>,
  };
}

/**
 * Phase 0 Codex approval copy. The companion bridges only two methods:
 * `item/commandExecution/requestApproval` and `item/fileChange/requestApproval`.
 * Title is plain text — path is rendered as inline code in the body when
 * applicable, not embedded in the header.
 */
function codexApprovalTitle(marker: CodexApprovalMarker): string {
  switch (marker.tool) {
    case 'codex.item/commandExecution/requestApproval':
      return 'Run shell command?';
    case 'codex.item/fileChange/requestApproval': {
      const count = fileChangeCount(marker.input);
      return count > 1 ? 'Write to files?' : 'Write to file?';
    }
    default:
      return 'Approve Codex action?';
  }
}

/**
 * Pulls the first changed path out of an `item/fileChange/requestApproval`
 * payload. The Codex protocol's request shape isn't tightly versioned —
 * `changes`, `files`, and a top-level `path` have all surfaced — so probe
 * each common key. Returns `undefined` when the shape is unrecognised, so
 * callers can fall back to a path-less label.
 */
function firstFileChangePath(
  input: Record<string, unknown>,
): string | undefined {
  const changes = (input.changes ?? input.files) as unknown;
  if (Array.isArray(changes) && changes.length > 0) {
    const first = changes[0] as Record<string, unknown> | undefined;
    if (first && typeof first === 'object') {
      const path = first.path ?? first.file;
      if (typeof path === 'string') return path;
    }
  }
  if (typeof input.path === 'string') return input.path;
  return undefined;
}

/**
 * Counts entries in an `item/fileChange/requestApproval` payload. Returns
 * `0` when the shape is unrecognised — used by the title to pick singular
 * vs. plural copy and by the body to render an "and N more" suffix.
 */
function fileChangeCount(input: Record<string, unknown>): number {
  const changes = (input.changes ?? input.files) as unknown;
  if (Array.isArray(changes)) return changes.length;
  return 0;
}

/**
 * Phase 0 Codex approval preview. Command approvals render the proposed
 * shell command in a terminal-styled block; file-change approvals render
 * the path(s) inline. Diff / syntax-highlight previews are deferred to
 * Phase 0.1.
 */
function CodexApprovalPreview({ marker }: { marker: CodexApprovalMarker }) {
  if (marker.tool === 'codex.item/commandExecution/requestApproval') {
    const command = String(marker.input.command ?? '');
    const cwd =
      typeof marker.input.cwd === 'string' ? marker.input.cwd : undefined;
    return (
      <div className="px-4 pb-2">
        {command && <Terminal output={command} />}
        {cwd && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            in <code className="font-mono">{cwd}</code>
          </p>
        )}
      </div>
    );
  }
  if (marker.tool === 'codex.item/fileChange/requestApproval') {
    const path = firstFileChangePath(marker.input);
    const count = fileChangeCount(marker.input);
    return (
      <div className="px-4 pb-2 text-xs text-muted-foreground">
        {path ? (
          <span>
            <code className="font-mono">{path}</code>
            {count > 1 && <span> and {count - 1} more</span>}
          </span>
        ) : (
          <span>{count > 0 ? `${count} files` : 'unknown path'}</span>
        )}
      </div>
    );
  }
  return null;
}

/**
 * Renders a single `dynamic-tool` UIMessage part — Claude SDK tool calls
 * (`Bash`, `Edit`, etc.) and Codex tool items (`commandExecution`,
 * `fileChange`, `mcpToolCall`, ...) share this surface. Branches on
 * `part.state` to render input only / streaming output / final output /
 * error / approval prompt. Codex approvals are detected via the
 * `approval.codex` marker (see {@link CodexApprovalMarker}); the title
 * and preview swap to Codex copy while the Approve / Deny buttons keep
 * the same shape.
 */
export default function ToolCallUI({ part }: ToolCallUIProps) {
  const { approve, deny } = useSessionActions();
  const [denyMode, setDenyMode] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');

  const isApprovalRequested = part.state === 'approval-requested';
  const isError = part.state === 'output-error';

  // Controlled open state so the card stays expanded across state transitions
  // once an approval has been requested. `defaultOpen` alone only applied on
  // first mount, and the part could mount before state flipped to
  // `approval-requested`, leaving users staring at a collapsed card. The user
  // can still collapse it manually via the header.
  const [open, setOpen] = useState(isApprovalRequested);
  useEffect(() => {
    if (isApprovalRequested) setOpen(true);
  }, [isApprovalRequested]);

  const codexMarker = getCodexApproval(part);
  const titleSummary = codexMarker
    ? codexApprovalTitle(codexMarker)
    : toolSummary(part.toolName, part.input as Record<string, unknown>);

  const handleApprove = () => {
    approve(part.toolCallId);
  };

  const handleConfirmDeny = () => {
    deny(part.toolCallId, denyMessage.trim() || undefined);
    setDenyMode(false);
    setDenyMessage('');
  };

  // Render output section based on tool type
  const renderOutput = () => {
    if (part.state !== 'output-available' && part.state !== 'output-error') {
      return null;
    }

    if (isError) {
      return (
        <ToolOutput
          output={undefined}
          errorText={part.errorText ?? 'An error occurred'}
        />
      );
    }

    if (BASH_TOOLS.has(part.toolName) && typeof part.output === 'string') {
      return (
        <ToolOutput
          output={<Terminal output={part.output} />}
          errorText={undefined}
        />
      );
    }

    return <ToolOutput output={part.output} errorText={undefined} />;
  };

  return (
    <Tool open={open} onOpenChange={setOpen}>
      <ToolHeader
        type="dynamic-tool"
        state={part.state}
        toolName={part.toolName}
        title={titleSummary || part.toolName}
      />
      <ToolContent>
        {codexMarker ? (
          <CodexApprovalPreview marker={codexMarker} />
        ) : (
          <ToolInput input={part.input} />
        )}
        {renderOutput()}

        {/* Approval UI — rendered inline within the tool content */}
        <Confirmation state={part.state} approval={part.approval}>
          <ConfirmationRequest>
            {!denyMode ? (
              <ConfirmationActions>
                <ConfirmationAction
                  className="bg-green-600 text-white hover:bg-green-700"
                  onClick={handleApprove}
                >
                  Approve
                </ConfirmationAction>
                <ConfirmationAction
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setDenyMode(true)}
                >
                  Deny
                </ConfirmationAction>
              </ConfirmationActions>
            ) : (
              <div className="flex flex-col gap-1.5">
                <textarea
                  value={denyMessage}
                  onChange={(e) => {
                    setDenyMessage(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = `${Math.min(e.target.scrollHeight, 8 * 20)}px`;
                  }}
                  aria-label="Denial reason (optional)"
                  placeholder="Reason (optional)"
                  rows={1}
                  className="w-full text-xs bg-background border border-input rounded px-2 py-1.5 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none overflow-y-auto"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleConfirmDeny();
                    }
                    if (e.key === 'Escape') {
                      setDenyMode(false);
                      setDenyMessage('');
                    }
                  }}
                  // biome-ignore lint/a11y/noAutofocus: deny reason input should be focused on reveal
                  autoFocus
                />
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="destructive"
                    className="min-h-11 px-3 text-xs"
                    onClick={handleConfirmDeny}
                  >
                    Confirm deny
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11 px-3 text-xs"
                    onClick={() => {
                      setDenyMode(false);
                      setDenyMessage('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </ConfirmationRequest>
          <ConfirmationAccepted>
            <p className="text-xs text-green-600">Approved</p>
          </ConfirmationAccepted>
          <ConfirmationRejected>
            <p className="text-xs text-destructive">Denied</p>
          </ConfirmationRejected>
        </Confirmation>
      </ToolContent>
    </Tool>
  );
}
