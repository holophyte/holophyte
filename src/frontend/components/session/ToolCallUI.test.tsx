import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DynamicToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Radix Collapsible — controls open/closed state simply
vi.mock('@/frontend/components/ui/collapsible', () => ({
  Collapsible: ({
    children,
    defaultOpen,
  }: {
    children: ReactNode;
    defaultOpen?: boolean;
    className?: string;
  }) => (
    <div data-testid="collapsible" data-open={defaultOpen ? 'true' : 'false'}>
      {children}
    </div>
  ),
  CollapsibleTrigger: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <button
      type="button"
      data-testid="collapsible-trigger"
      className={className}
    >
      {children}
    </button>
  ),
  CollapsibleContent: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="collapsible-content" className={className}>
      {children}
    </div>
  ),
}));

// Mock Badge
vi.mock('@/frontend/components/ui/Badge', () => ({
  Badge: ({ children }: { children: ReactNode }) => (
    <span data-testid="badge">{children}</span>
  ),
}));

// Mock Alert
vi.mock('@/frontend/components/ui/alert', () => ({
  Alert: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="alert" className={className}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: ReactNode }) => (
    <span>{children}</span>
  ),
}));

// Mock Terminal
vi.mock('@/frontend/components/ai-elements/terminal', () => ({
  Terminal: ({ output }: { output: string }) => (
    <div data-testid="terminal">{output}</div>
  ),
}));

// Mock CodeBlock
vi.mock('@/frontend/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => (
    <pre data-testid="code-block">{code}</pre>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePart(
  overrides: Partial<DynamicToolUIPart> = {},
): DynamicToolUIPart {
  return {
    type: 'dynamic-tool',
    toolName: 'Bash',
    toolCallId: 'tc-1',
    state: 'output-available',
    input: { command: 'ls' },
    ...overrides,
  } as DynamicToolUIPart;
}

function withSessionActions(approve = vi.fn(), deny = vi.fn()) {
  return ({ children }: { children: ReactNode }) => (
    <SessionActionsContext.Provider
      value={{
        approve,
        deny,
        pendingApprovals: [],
        sessionStatus: 'idle',
        promptSuggestion: null,
        availableCommands: [],
        handleStop: vi.fn().mockResolvedValue(undefined),
        messageQueued: false,
        sendMessage: vi.fn().mockResolvedValue(undefined),
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

import ToolCallUI from './ToolCallUI';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ToolCallUI', () => {
  describe('rendering', () => {
    it('renders without crashing', () => {
      expect(() =>
        render(<ToolCallUI part={makePart()} />, {
          wrapper: withSessionActions(),
        }),
      ).not.toThrow();
    });

    it('renders a collapsible tool container', () => {
      render(<ToolCallUI part={makePart()} />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('collapsible')).toBeInTheDocument();
    });

    it('renders tool header with trigger', () => {
      render(<ToolCallUI part={makePart()} />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('collapsible-trigger')).toBeInTheDocument();
    });

    it('shows tool name in the header', () => {
      render(<ToolCallUI part={makePart({ toolName: 'Read' })} />, {
        wrapper: withSessionActions(),
      });
      // toolSummary for Read with file_path
      expect(
        screen.getByTestId('collapsible-trigger').textContent,
      ).toBeTruthy();
    });

    it('renders tool input content', () => {
      render(<ToolCallUI part={makePart()} />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('collapsible-content')).toBeInTheDocument();
    });
  });

  describe('state: output-available', () => {
    it('renders Bash output in a Terminal', () => {
      const part = makePart({
        toolName: 'Bash',
        state: 'output-available',
        input: { command: 'ls' },
        output: 'file.ts\nother.ts',
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('terminal')).toBeInTheDocument();
      // Terminal mock renders output — text may be split across nodes
      expect(screen.getByTestId('terminal').textContent).toContain('file.ts');
    });

    it('renders non-Bash string output in a CodeBlock', () => {
      const part = makePart({
        toolName: 'Read',
        state: 'output-available',
        input: { file_path: 'src/foo.ts' },
        output: 'const x = 1;',
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      // ToolOutput renders string via CodeBlock — there's also one for input,
      // so we expect at least 2 code-blocks total
      const codeBlocks = screen.getAllByTestId('code-block');
      expect(codeBlocks.length).toBeGreaterThanOrEqual(2);
      const outputBlock = codeBlocks.find((el) =>
        el.textContent?.includes('const x = 1;'),
      );
      expect(outputBlock).toBeDefined();
    });
  });

  describe('state: output-error', () => {
    it('shows error output when state is output-error', () => {
      const part = makePart({
        state: 'output-error',
        errorText: 'Command failed',
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      // ToolOutput renders errorText
      expect(screen.getByText('Command failed')).toBeInTheDocument();
    });
  });

  describe('state: input-available (running)', () => {
    it('does not show output section when still running', () => {
      const part = makePart({ state: 'input-available', output: undefined });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.queryByTestId('terminal')).not.toBeInTheDocument();
      expect(screen.queryByTestId('alert')).not.toBeInTheDocument();
    });
  });

  describe('state: approval-requested', () => {
    it('opens collapsible by default when approval is requested', () => {
      const part = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      const collapsible = screen.getByTestId('collapsible');
      expect(collapsible).toHaveAttribute('data-open', 'true');
    });

    it('renders Approve button', () => {
      const part = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });

    it('renders Deny button', () => {
      const part = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });

    it('calls approve with toolCallId when Approve is clicked', async () => {
      const approve = vi.fn();
      const part = makePart({
        toolCallId: 'tc-42',
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, {
        wrapper: withSessionActions(approve),
      });
      await userEvent.click(screen.getByRole('button', { name: /approve/i }));
      expect(approve).toHaveBeenCalledWith('tc-42');
    });

    it('shows deny reason textarea after clicking Deny', async () => {
      const part = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      await userEvent.click(screen.getByRole('button', { name: /^deny$/i }));
      expect(
        screen.getByRole('textbox', { name: /denial reason/i }),
      ).toBeInTheDocument();
    });

    it('calls deny with toolCallId and message on Confirm deny', async () => {
      const deny = vi.fn();
      const part = makePart({
        toolCallId: 'tc-99',
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, {
        wrapper: withSessionActions(vi.fn(), deny),
      });
      await userEvent.click(screen.getByRole('button', { name: /^deny$/i }));
      await userEvent.type(
        screen.getByRole('textbox', { name: /denial reason/i }),
        'Too risky',
      );
      await userEvent.click(
        screen.getByRole('button', { name: /confirm deny/i }),
      );
      expect(deny).toHaveBeenCalledWith('tc-99', 'Too risky');
    });

    it('calls deny with undefined message when reason is empty', async () => {
      const deny = vi.fn();
      const part = makePart({
        toolCallId: 'tc-5',
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, {
        wrapper: withSessionActions(vi.fn(), deny),
      });
      await userEvent.click(screen.getByRole('button', { name: /^deny$/i }));
      await userEvent.click(
        screen.getByRole('button', { name: /confirm deny/i }),
      );
      expect(deny).toHaveBeenCalledWith('tc-5', undefined);
    });

    it('cancels deny mode and restores approve/deny buttons', async () => {
      const part = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      await userEvent.click(screen.getByRole('button', { name: /^deny$/i }));
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^deny$/i }),
      ).toBeInTheDocument();
    });
  });

  describe('state: output-denied', () => {
    it('does not show approval buttons for output-denied state', () => {
      const part = makePart({
        state: 'output-denied',
        approval: { id: 'appr-1', approved: false },
      });
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(
        screen.queryByRole('button', { name: /approve/i }),
      ).not.toBeInTheDocument();
    });
  });
});
