import { AlertTriangle, Check, X } from 'lucide-react';
import { useState } from 'react';
import type { PendingApproval } from '@/frontend/hooks/useSession';
import Button from './ui/Button';

/** Props for {@link PermissionPrompt}. */
interface PermissionPromptProps {
  /** The pending tool-use approval to display. */
  approval: PendingApproval;
  /** Called when the user clicks "Approve". */
  onApprove: () => void;
  /**
   * Called when the user confirms denial. Receives the optional rejection
   * reason text that is forwarded to Claude as feedback.
   */
  onDeny: (message?: string) => void;
}

function permissionDescription(
  tool: string,
  input: Record<string, unknown>,
): string {
  switch (tool) {
    case 'Bash':
      return `Run command: ${typeof input.command === 'string' ? input.command : JSON.stringify(input)}`;
    case 'Edit':
      return `Edit file: ${typeof input.file_path === 'string' ? input.file_path : JSON.stringify(input)}`;
    case 'Write':
      return `Write file: ${typeof input.file_path === 'string' ? input.file_path : JSON.stringify(input)}`;
    case 'Read':
      return `Read file: ${typeof input.file_path === 'string' ? input.file_path : JSON.stringify(input)}`;
    default:
      return `Use ${tool}`;
  }
}

/**
 * Amber-accented card shown when Claude requests permission to use a tool
 * that wasn't auto-approved by the session's permission mode.
 *
 * - Clicking "Approve" calls `onApprove` immediately.
 * - Clicking "Deny" reveals an optional reason input; submitting calls
 *   `onDeny(reason)`. Pressing Escape cancels.
 * - For `Bash`, `Edit`, and `Write` tools, the full input JSON is shown so
 *   the user can make an informed decision.
 *
 * Multiple `PermissionPrompt` instances are stacked when Claude issues
 * several tool-use requests in quick succession.
 */
export default function PermissionPrompt({
  approval,
  onApprove,
  onDeny,
}: PermissionPromptProps) {
  const [showDenyInput, setShowDenyInput] = useState(false);
  const [denyReason, setDenyReason] = useState('');

  const handleDeny = () => {
    onDeny(denyReason.trim() || undefined);
    setShowDenyInput(false);
    setDenyReason('');
  };

  return (
    <div className="px-3 py-2.5 border-b border-amber-500/20 bg-amber-500/5 last:border-b-0">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-amber-400/90 mb-0.5">
            Permission required — {approval.tool}
          </p>
          <p className="text-xs text-muted-foreground break-all">
            {permissionDescription(approval.tool, approval.input)}
          </p>

          {/* Show input details for Bash/Write/Edit */}
          {(approval.tool === 'Bash' ||
            approval.tool === 'Edit' ||
            approval.tool === 'Write') && (
            <pre className="mt-1.5 text-[10px] bg-muted/40 rounded px-2 py-1.5 overflow-x-auto text-muted-foreground leading-relaxed max-h-28 overflow-y-auto">
              {JSON.stringify(approval.input, null, 2)}
            </pre>
          )}

          {showDenyInput && (
            <div className="mt-2">
              <textarea
                value={denyReason}
                onChange={(e) => {
                  setDenyReason(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 8 * 20)}px`;
                }}
                placeholder="Reason (optional)"
                rows={1}
                className="w-full text-xs bg-background border border-input rounded px-2 py-1.5 placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none overflow-y-auto"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleDeny();
                  }
                  if (e.key === 'Escape') {
                    setShowDenyInput(false);
                    setDenyReason('');
                  }
                }}
                // biome-ignore lint/a11y/noAutofocus: deny reason input should be focused on reveal
                autoFocus
              />
            </div>
          )}

          <div className="flex gap-1.5 mt-2">
            {!showDenyInput ? (
              <>
                <Button
                  size="sm"
                  className="h-7 px-2.5 text-xs bg-green-600 hover:bg-green-700 text-white"
                  onClick={onApprove}
                >
                  <Check className="h-3 w-3 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={() => setShowDenyInput(true)}
                >
                  <X className="h-3 w-3 mr-1" />
                  Deny
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 px-2.5 text-xs"
                  onClick={handleDeny}
                >
                  Confirm deny
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => {
                    setShowDenyInput(false);
                    setDenyReason('');
                  }}
                >
                  Cancel
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
