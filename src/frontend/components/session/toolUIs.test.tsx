import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// makeAssistantToolUI returns a component with a render prop — simulate it
vi.mock('@assistant-ui/react', () => ({
  makeAssistantToolUI: vi.fn(
    ({
      render: renderFn,
    }: {
      toolName: string;
      render: (props: unknown) => ReactNode;
    }) => renderFn,
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withSessionActions(
  pendingApprovals: Array<{
    requestId: string;
    tool: string;
    input: Record<string, unknown>;
    resolved?: { approved: boolean };
  }> = [],
  approve = vi.fn(),
  deny = vi.fn(),
) {
  return ({ children }: { children: ReactNode }) => (
    <SessionActionsContext.Provider
      value={{
        approve,
        deny,
        requestStop: vi.fn().mockResolvedValue(undefined),
        pendingApprovals,
        sessionStatus: pendingApprovals.length > 0 ? 'waiting_input' : 'idle',
        promptSuggestion: null,
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

// Import after mocks are set up — toolUIs uses makeAssistantToolUI
import * as toolUIs from './toolUIs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('toolUIs', () => {
  describe('exports', () => {
    it('exports BashToolUI', () => {
      expect(toolUIs.BashToolUI).toBeDefined();
    });

    it('exports ReadToolUI', () => {
      expect(toolUIs.ReadToolUI).toBeDefined();
    });

    it('exports EditToolUI', () => {
      expect(toolUIs.EditToolUI).toBeDefined();
    });

    it('exports WriteToolUI', () => {
      expect(toolUIs.WriteToolUI).toBeDefined();
    });

    it('exports GlobToolUI', () => {
      expect(toolUIs.GlobToolUI).toBeDefined();
    });

    it('exports GrepToolUI', () => {
      expect(toolUIs.GrepToolUI).toBeDefined();
    });

    it('exports GenericToolUI or a wildcard fallback', () => {
      // Either a GenericToolUI export or a wildcard export should exist
      const hasGeneric =
        'GenericToolUI' in toolUIs ||
        'WildcardToolUI' in toolUIs ||
        'DefaultToolUI' in toolUIs;
      expect(hasGeneric).toBe(true);
    });
  });

  // The render functions returned by makeAssistantToolUI are the actual render props.
  // We test the ToolCallDisplay (shared inner component) behavior through them.

  describe('ToolCallDisplay (shared inner component)', () => {
    const bashArgs = { command: 'bun run test' };

    function renderBashTool(
      props: {
        toolCallId?: string;
        args?: Record<string, unknown>;
        result?: unknown;
        status?: { type: string };
      },
      pendingApprovals: Array<{
        requestId: string;
        tool: string;
        input: Record<string, unknown>;
        resolved?: { approved: boolean };
      }> = [],
    ) {
      const RenderFn = toolUIs.BashToolUI as unknown as React.ComponentType<{
        toolCallId: string;
        args: Record<string, unknown>;
        result?: unknown;
        status?: { type: string };
      }>;
      return render(
        <RenderFn
          toolCallId={props.toolCallId ?? 'tool-1'}
          args={props.args ?? bashArgs}
          result={props.result}
          status={props.status}
        />,
        { wrapper: withSessionActions(pendingApprovals) },
      );
    }

    describe('collapsed state (default)', () => {
      it('renders tool summary in collapsed state', () => {
        renderBashTool({ args: bashArgs });
        // Should render a summary of the bash command somewhere
        expect(screen.getByText(/bun run test/)).toBeInTheDocument();
      });

      it('does not show input details when collapsed', () => {
        renderBashTool({ args: bashArgs });
        // "Input" section label should not be visible by default
        expect(screen.queryByText('Input')).not.toBeInTheDocument();
      });
    });

    describe('expand / collapse toggle', () => {
      it('expands to show input on click', async () => {
        const user = userEvent.setup();
        renderBashTool({ args: bashArgs });
        const btn = screen.getByRole('button');
        await user.click(btn);
        // After expanding, should show input details
        expect(screen.getByText(/command/i)).toBeInTheDocument();
      });

      it('collapses back on second click', async () => {
        const user = userEvent.setup();
        renderBashTool({ args: bashArgs });
        const btn = screen.getByRole('button');
        await user.click(btn);
        await user.click(btn);
        expect(screen.queryByText('Input')).not.toBeInTheDocument();
      });
    });

    describe('result display', () => {
      it('shows result content when result is provided and expanded', async () => {
        const user = userEvent.setup();
        renderBashTool({ args: bashArgs, result: 'All tests passed' });
        await user.click(screen.getByRole('button'));
        expect(screen.getByText(/All tests passed/)).toBeInTheDocument();
      });

      it('truncates long results with "Show more" button', async () => {
        const user = userEvent.setup();
        renderBashTool({ args: bashArgs, result: 'x'.repeat(2100) });
        await user.click(screen.getByRole('button'));
        expect(screen.getByText('Show more')).toBeInTheDocument();
      });

      it('shows full result after clicking "Show more"', async () => {
        const user = userEvent.setup();
        renderBashTool({ args: bashArgs, result: 'x'.repeat(2100) });
        await user.click(screen.getByRole('button'));
        await user.click(screen.getByText('Show more'));
        expect(screen.getByText('Show less')).toBeInTheDocument();
      });
    });

    describe('pending approval display', () => {
      it('shows approval pending indicator when tool call has unresolved approval', () => {
        renderBashTool({ toolCallId: 'tool-1', args: bashArgs }, [
          {
            requestId: 'tool-1',
            tool: 'Bash',
            input: bashArgs,
          },
        ]);
        // Should show some indication that approval is needed
        const hasApprovalUI =
          screen.queryByRole('button', { name: /approve/i }) !== null ||
          screen.queryByText(/approval/i) !== null ||
          screen.queryByText(/needs approval/i) !== null;
        expect(hasApprovalUI).toBe(true);
      });

      it('does not show approval UI for resolved approvals', () => {
        renderBashTool({ toolCallId: 'tool-1', args: bashArgs }, [
          {
            requestId: 'tool-1',
            tool: 'Bash',
            input: bashArgs,
            resolved: { approved: true },
          },
        ]);
        expect(
          screen.queryByRole('button', { name: /approve/i }),
        ).not.toBeInTheDocument();
      });
    });

    describe('smoke tests — all tool UIs render without crashing', () => {
      type ToolRenderComponent = React.ComponentType<{
        toolCallId: string;
        args: Record<string, unknown>;
      }>;

      const toolCases: Array<[ToolRenderComponent, Record<string, unknown>]> = [
        [
          toolUIs.BashToolUI as unknown as ToolRenderComponent,
          { command: 'ls' },
        ],
        [
          toolUIs.ReadToolUI as unknown as ToolRenderComponent,
          { file_path: 'x.ts' },
        ],
        [
          toolUIs.EditToolUI as unknown as ToolRenderComponent,
          { file_path: 'x.ts' },
        ],
        [
          toolUIs.WriteToolUI as unknown as ToolRenderComponent,
          { file_path: 'x.ts' },
        ],
        [
          toolUIs.GlobToolUI as unknown as ToolRenderComponent,
          { pattern: '**/*.ts' },
        ],
        [
          toolUIs.GrepToolUI as unknown as ToolRenderComponent,
          { pattern: 'useSession' },
        ],
      ];

      for (const [ToolUI, args] of toolCases) {
        it(`${ToolUI.displayName ?? ToolUI.name} renders without error`, () => {
          expect(() =>
            render(<ToolUI toolCallId="tc-1" args={args} />, {
              wrapper: withSessionActions(),
            }),
          ).not.toThrow();
        });
      }
    });
  });

  // ReadToolUI smoke test with file path summary
  describe('ReadToolUI', () => {
    it('shows file path in summary', () => {
      const ReadUI = toolUIs.ReadToolUI as unknown as React.ComponentType<{
        toolCallId: string;
        args: Record<string, unknown>;
      }>;
      render(
        <ReadUI toolCallId="tc-2" args={{ file_path: 'src/server.ts' }} />,
        {
          wrapper: withSessionActions(),
        },
      );
      expect(screen.getByText(/src\/server\.ts/)).toBeInTheDocument();
    });
  });
});
