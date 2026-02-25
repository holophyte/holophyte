import { Check, X } from 'lucide-react';
import { useState } from 'react';
import Button from '@/frontend/components/ui/Button';
import { cn } from '@/frontend/lib/utils';
import { useSessionActions } from './SessionActionsContext';

interface ApprovalButtonsProps {
  requestId: string;
}

export default function ApprovalButtons({ requestId }: ApprovalButtonsProps) {
  const { approve, deny } = useSessionActions();
  const [denyMode, setDenyMode] = useState(false);
  const [denyMessage, setDenyMessage] = useState('');

  const handleApprove = () => {
    approve(requestId);
  };

  const handleConfirmDeny = () => {
    deny(requestId, denyMessage.trim() || undefined);
    setDenyMode(false);
    setDenyMessage('');
  };

  return (
    <div data-request-id={requestId} className="flex flex-col gap-1.5">
      {!denyMode ? (
        <div className="flex gap-1.5">
          <Button
            size="sm"
            className={cn(
              'min-h-11 px-3 text-xs bg-green-600 hover:bg-green-700 text-white',
            )}
            onClick={handleApprove}
          >
            <Check className="h-3 w-3 mr-1" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="min-h-11 px-3 text-xs border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={() => setDenyMode(true)}
          >
            <X className="h-3 w-3 mr-1" />
            Deny
          </Button>
        </div>
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
    </div>
  );
}
