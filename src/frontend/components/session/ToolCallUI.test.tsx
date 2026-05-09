import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DynamicToolUIPart } from 'ai';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock Radix Collapsible — reflect whichever of open/defaultOpen is provided.
// ToolCallUI uses controlled `open`, but tests that still pass `defaultOpen`
// (or nothing) should see the same data-open behavior.
vi.mock('@/frontend/components/ui/collapsible', () => ({
  Collapsible: ({
    children,
    open,
    defaultOpen,
  }: {
    children: ReactNode;
    open?: boolean;
    defaultOpen?: boolean;
    onOpenChange?: (next: boolean) => void;
    className?: string;
  }) => {
    const isOpen = open ?? defaultOpen ?? false;
    return (
      <div data-testid="collapsible" data-open={isOpen ? 'true' : 'false'}>
        {children}
      </div>
    );
  },
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
        provider: 'claude',
        effort: 'auto',
        setEffort: vi.fn(),
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

    it('stays open after the part transitions out of approval-requested', () => {
      // Repro for GH #246: the card should remain expanded once an approval
      // has been seen, even if the state flips to approval-responded or
      // output-available afterwards.
      const initial = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      const { rerender } = render(<ToolCallUI part={initial} />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('collapsible')).toHaveAttribute(
        'data-open',
        'true',
      );

      const resolved = makePart({
        state: 'output-available',
        output: 'done',
        approval: { id: 'appr-1', approved: true },
      });
      rerender(<ToolCallUI part={resolved} />);
      expect(screen.getByTestId('collapsible')).toHaveAttribute(
        'data-open',
        'true',
      );
    });

    it('opens when an approval arrives after an earlier non-approval state', () => {
      // Repro for GH #246: if the tool mounts before the approval-requested
      // event lands (e.g. input-available first), the card should still open
      // when the state transitions into approval-requested.
      const initial = makePart({ state: 'input-available' });
      const { rerender } = render(<ToolCallUI part={initial} />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('collapsible')).toHaveAttribute(
        'data-open',
        'false',
      );

      const approving = makePart({
        state: 'approval-requested',
        approval: { id: 'appr-1' },
      });
      rerender(<ToolCallUI part={approving} />);
      expect(screen.getByTestId('collapsible')).toHaveAttribute(
        'data-open',
        'true',
      );
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

  describe('Codex approval markers', () => {
    it('renders "Run shell command?" header for commandExecution approvals', () => {
      const part = makePart({
        toolName: 'Bash',
        toolCallId: 'cmd-1',
        state: 'approval-requested',
        input: { command: 'ls' },
        approval: {
          id: 'cmd-1',
          codex: {
            tool: 'codex.item/commandExecution/requestApproval',
            input: { command: 'ls -la', cwd: '/tmp' },
          },
        },
      } as unknown as DynamicToolUIPart);
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('collapsible-trigger').textContent).toContain(
        'Run shell command?',
      );
      // Command preview comes from the approval payload (input.command),
      // not the placeholder tool input.
      expect(screen.getByTestId('terminal').textContent).toContain('ls -la');
    });

    it('renders "Write to file?" header and shows path for fileChange approvals', () => {
      const part = makePart({
        toolName: 'Edit',
        toolCallId: 'fc-1',
        state: 'approval-requested',
        input: {},
        approval: {
          id: 'fc-1',
          codex: {
            tool: 'codex.item/fileChange/requestApproval',
            input: { changes: [{ path: '/tmp/x.ts' }] },
          },
        },
      } as unknown as DynamicToolUIPart);
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('collapsible-trigger').textContent).toContain(
        'Write to file?',
      );
      expect(screen.getByText('/tmp/x.ts')).toBeInTheDocument();
    });

    it('renders "+N more" suffix when fileChange approval lists multiple paths', () => {
      const part = makePart({
        toolName: 'Edit',
        toolCallId: 'fc-multi',
        state: 'approval-requested',
        input: {},
        approval: {
          id: 'fc-multi',
          codex: {
            tool: 'codex.item/fileChange/requestApproval',
            input: {
              changes: [
                { path: '/tmp/a.ts' },
                { path: '/tmp/b.ts' },
                { path: '/tmp/c.ts' },
              ],
            },
          },
        },
      } as unknown as DynamicToolUIPart);
      render(<ToolCallUI part={part} />, { wrapper: withSessionActions() });
      expect(screen.getByText('/tmp/a.ts')).toBeInTheDocument();
      expect(screen.getByText(/and 2 more/)).toBeInTheDocument();
    });

    it('routes Approve click through approve(toolCallId) for codex parts', async () => {
      const approve = vi.fn();
      const part = makePart({
        toolName: 'Bash',
        toolCallId: 'cmd-route',
        state: 'approval-requested',
        input: {},
        approval: {
          id: 'cmd-route',
          codex: {
            tool: 'codex.item/commandExecution/requestApproval',
            input: { command: 'ls' },
          },
        },
      } as unknown as DynamicToolUIPart);
      render(<ToolCallUI part={part} />, {
        wrapper: withSessionActions(approve),
      });
      await userEvent.click(screen.getByRole('button', { name: /approve/i }));
      expect(approve).toHaveBeenCalledWith('cmd-route');
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
