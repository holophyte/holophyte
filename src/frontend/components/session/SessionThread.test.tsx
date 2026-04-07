import { render, screen } from '@testing-library/react';
import type { UIMessage } from 'ai';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock use-stick-to-bottom — Conversation wraps StickToBottom
vi.mock('use-stick-to-bottom', () => {
  const StickToBottom = ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="stick-to-bottom" className={className}>
      {children}
    </div>
  );
  StickToBottom.Content = ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <div data-testid="stick-to-bottom-content" className={className}>
      {children}
    </div>
  );

  const useStickToBottomContext = () => ({
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  });

  return { StickToBottom, useStickToBottomContext };
});

// Mock SessionComposer
vi.mock('./SessionComposer', () => ({
  default: () => <div data-testid="session-composer" />,
}));

// Mock ToolCallUI
vi.mock('./ToolCallUI', () => ({
  default: ({ part }: { part: { toolName: string } }) => (
    <div data-testid="tool-call-ui">{part.toolName}</div>
  ),
}));

// Mock Streamdown (used by MessageResponse)
vi.mock('streamdown', () => ({
  Streamdown: ({ children }: { children: ReactNode }) => (
    <div data-testid="streamdown">{children}</div>
  ),
}));

// Mock streamdown plugins
vi.mock('@streamdown/cjk', () => ({ cjk: {} }));
vi.mock('@streamdown/code', () => ({ code: {} }));
vi.mock('@streamdown/math', () => ({ math: {} }));
vi.mock('@streamdown/mermaid', () => ({ mermaid: {} }));

// Mock reasoning component
vi.mock('@/frontend/components/ai-elements/reasoning', () => ({
  Reasoning: ({ children }: { children: ReactNode }) => (
    <div data-testid="reasoning">{children}</div>
  ),
  ReasoningTrigger: () => <div data-testid="reasoning-trigger" />,
  ReasoningContent: ({ children }: { children: string }) => (
    <div data-testid="reasoning-content">{children}</div>
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMessages(overrides: Partial<UIMessage>[] = []): UIMessage[] {
  return overrides.map((o, i) => ({
    id: `msg-${i}`,
    role: 'assistant' as const,
    parts: [],
    ...o,
  }));
}

function withSessionActions(
  sessionStatus:
    | 'running'
    | 'waiting_input'
    | 'idle'
    | 'failed'
    | null = 'idle',
) {
  return ({ children }: { children: ReactNode }) => (
    <SessionActionsContext.Provider
      value={{
        approve: vi.fn(),
        deny: vi.fn(),
        pendingApprovals: [],
        sessionStatus,
        promptSuggestion: null,
        availableCommands: [],
        handleStop: vi.fn().mockResolvedValue(undefined),
        messageQueued: false,
        sendMessage: vi.fn().mockResolvedValue(undefined),
        addOptimisticMessage: vi.fn(),
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

import SessionThread from './SessionThread';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionThread', () => {
  describe('structure', () => {
    it('renders without crashing', () => {
      expect(() =>
        render(<SessionThread messages={[]} status="ready" />, {
          wrapper: withSessionActions(),
        }),
      ).not.toThrow();
    });

    it('renders the conversation container', () => {
      render(<SessionThread messages={[]} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('stick-to-bottom')).toBeInTheDocument();
    });

    it('renders SessionComposer', () => {
      render(<SessionThread messages={[]} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('session-composer')).toBeInTheDocument();
    });
  });

  describe('message rendering', () => {
    it('renders text parts for assistant messages via MessageResponse', () => {
      const messages = makeMessages([
        {
          role: 'assistant',
          parts: [{ type: 'text', text: 'Hello from Claude' }],
        },
      ]);
      render(<SessionThread messages={messages} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('streamdown')).toBeInTheDocument();
      expect(screen.getByText('Hello from Claude')).toBeInTheDocument();
    });

    it('renders user message text as pre-wrapped paragraph', () => {
      const messages = makeMessages([
        {
          role: 'user',
          parts: [{ type: 'text', text: 'My prompt' }],
        },
      ]);
      render(<SessionThread messages={messages} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByText('My prompt')).toBeInTheDocument();
    });

    it('renders ToolCallUI for dynamic-tool parts', () => {
      const messages = makeMessages([
        {
          role: 'assistant',
          parts: [
            {
              type: 'dynamic-tool',
              toolName: 'Bash',
              toolCallId: 'tc-1',
              state: 'output-available',
              input: { command: 'ls' },
              output: 'file1.ts',
            },
          ],
        },
      ]);
      render(<SessionThread messages={messages} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByTestId('tool-call-ui')).toBeInTheDocument();
      expect(screen.getByText('Bash')).toBeInTheDocument();
    });

    it('renders multiple messages', () => {
      const messages = makeMessages([
        { role: 'user', parts: [{ type: 'text', text: 'Question' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'Answer' }] },
      ]);
      render(<SessionThread messages={messages} status="ready" />, {
        wrapper: withSessionActions(),
      });
      expect(screen.getByText('Question')).toBeInTheDocument();
      expect(screen.getByText('Answer')).toBeInTheDocument();
    });
  });

  describe('ThinkingIndicator', () => {
    it('shows thinking indicator when session is running', () => {
      render(<SessionThread messages={[]} status="streaming" />, {
        wrapper: withSessionActions('running'),
      });
      const thinkingEl =
        screen.queryByText(/thinking/i) ??
        screen.queryByTestId('thinking-indicator');
      expect(thinkingEl).toBeInTheDocument();
    });

    it('does not show thinking indicator when session is idle', () => {
      render(<SessionThread messages={[]} status="ready" />, {
        wrapper: withSessionActions('idle'),
      });
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    });

    it('does not show thinking indicator when session is failed', () => {
      render(<SessionThread messages={[]} status="error" />, {
        wrapper: withSessionActions('failed'),
      });
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    });
  });
});
