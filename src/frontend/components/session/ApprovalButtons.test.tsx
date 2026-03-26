import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ApprovalButtons from './ApprovalButtons';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Test helper — wraps component with a SessionActionsContext provider
// ---------------------------------------------------------------------------

interface MockSessionActionsOptions {
  approve?: (requestId: string) => void;
  deny?: (requestId: string, message?: string) => void;
  pendingApprovals?: Array<{
    requestId: string;
    tool: string;
    input: Record<string, unknown>;
    resolved?: { approved: boolean };
  }>;
  sessionStatus?: 'running' | 'waiting_input' | 'idle' | 'failed' | null;
}

function withSessionActions(
  opts: MockSessionActionsOptions = {},
): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const value = {
    approve: opts.approve ?? vi.fn(),
    deny: opts.deny ?? vi.fn(),
    pendingApprovals: opts.pendingApprovals ?? [],
    sessionStatus: opts.sessionStatus ?? 'waiting_input',
    promptSuggestion: null,
    availableCommands: [],
    handleStop: vi.fn().mockResolvedValue(undefined),
    messageQueued: false,
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };
  return ({ children }) => (
    <SessionActionsContext.Provider value={value}>
      {children}
    </SessionActionsContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ApprovalButtons', () => {
  describe('rendering', () => {
    it('renders Approve button', () => {
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions(),
      });
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });

    it('renders Deny button', () => {
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });

    it('renders with data-request-id attribute for keyboard targeting', () => {
      const { container } = render(<ApprovalButtons requestId="req-42" />, {
        wrapper: withSessionActions(),
      });
      const el = container.querySelector('[data-request-id="req-42"]');
      expect(el).toBeInTheDocument();
    });
  });

  describe('Approve flow', () => {
    it('calls approve with the requestId when Approve is clicked', async () => {
      const approve = vi.fn();
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions({ approve }),
      });
      await user.click(screen.getByRole('button', { name: /approve/i }));
      expect(approve).toHaveBeenCalledWith('req-1');
    });

    it('calls approve exactly once per click', async () => {
      const approve = vi.fn();
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions({ approve }),
      });
      await user.click(screen.getByRole('button', { name: /approve/i }));
      expect(approve).toHaveBeenCalledOnce();
    });
  });

  describe('Deny flow', () => {
    it('clicking Deny reveals a deny confirmation UI', async () => {
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions(),
      });
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      // Should show some way to confirm deny — either a textarea or confirm button
      const confirmBtn = screen.queryByRole('button', {
        name: /confirm deny/i,
      });
      const textarea = screen.queryByRole('textbox');
      expect(confirmBtn ?? textarea).toBeInTheDocument();
    });

    it('calls deny with requestId when Confirm deny is clicked (no message)', async () => {
      const deny = vi.fn();
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions({ deny }),
      });
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.click(screen.getByRole('button', { name: /confirm deny/i }));
      expect(deny).toHaveBeenCalledWith('req-1', undefined);
    });

    it('calls deny with requestId and message when reason is typed', async () => {
      const deny = vi.fn();
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions({ deny }),
      });
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      const textarea = screen.getByRole('textbox');
      await user.type(textarea, 'Too risky');
      await user.click(screen.getByRole('button', { name: /confirm deny/i }));
      expect(deny).toHaveBeenCalledWith('req-1', 'Too risky');
    });

    it('hides Approve/Deny buttons once Deny is clicked', async () => {
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions(),
      });
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      expect(
        screen.queryByRole('button', { name: /^approve$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^deny$/i }),
      ).not.toBeInTheDocument();
    });

    it('cancels deny mode when Cancel is clicked, restoring approve/deny buttons', async () => {
      const user = userEvent.setup();
      render(<ApprovalButtons requestId="req-1" />, {
        wrapper: withSessionActions(),
      });
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });
  });

  describe('context error boundary', () => {
    it('throws when rendered outside SessionActionsProvider', () => {
      // Suppress expected console.error from React's error boundary
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => render(<ApprovalButtons requestId="req-1" />)).toThrow();
      spy.mockRestore();
    });
  });
});
