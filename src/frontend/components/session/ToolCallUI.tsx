import type { DynamicToolUIPart } from 'ai';
import { useState } from 'react';
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

export default function ToolCallUI({ part }: ToolCallUIProps) {
  const { approve, deny } = useSessionActions();
  const [denyMode, setDenyMode] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');

  const isApprovalRequested = part.state === 'approval-requested';
  const isError = part.state === 'output-error';

  const titleSummary = toolSummary(
    part.toolName,
    part.input as Record<string, unknown>,
  );

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
    <Tool defaultOpen={isApprovalRequested}>
      <ToolHeader
        type="dynamic-tool"
        state={part.state}
        toolName={part.toolName}
        title={titleSummary || part.toolName}
      />
      <ToolContent>
        <ToolInput input={part.input} />
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
