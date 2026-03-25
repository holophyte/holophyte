import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockScrollToBottom } = vi.hoisted(() => ({
  mockScrollToBottom: vi.fn(),
}));

vi.mock('@assistant-ui/react', () => {
  const ThreadPrimitive = {
    Root: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div data-testid="thread-root" className={className}>
        {children}
      </div>
    ),
    Viewport: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <div
        data-testid="thread-viewport"
        className={className}
        style={{ overflowY: 'auto' }}
      >
        {children}
      </div>
    ),
    Messages: ({
      components,
    }: {
      components?: {
        UserMessage?: React.ComponentType;
        AssistantMessage?: React.ComponentType;
      };
    }) => (
      <div data-testid="thread-messages">
        {/* Render placeholders to verify custom components are wired */}
        {components?.UserMessage && (
          <span data-testid="custom-user-message-registered" />
        )}
        {components?.AssistantMessage && (
          <span data-testid="custom-assistant-message-registered" />
        )}
      </div>
    ),
  };

  const useThreadViewport = (
    selector: (s: Record<string, unknown>) => unknown,
  ) => selector({ scrollToBottom: mockScrollToBottom, isAtBottom: true });

  return { ThreadPrimitive, useThreadViewport };
});

// Mock SessionComposer
vi.mock('./SessionComposer', () => ({
  default: () => <div data-testid="session-composer" />,
}));

// Mock CustomUserMessage and CustomAssistantMessage
vi.mock('./CustomUserMessage', () => ({
  default: () => <div data-testid="custom-user-message" />,
}));

vi.mock('./CustomAssistantMessage', () => ({
  default: () => <div data-testid="custom-assistant-message" />,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    it('renders ThreadPrimitive.Root', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('thread-root')).toBeInTheDocument();
    });

    it('renders ThreadPrimitive.Viewport', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('thread-viewport')).toBeInTheDocument();
    });

    it('renders ThreadPrimitive.Messages', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('thread-messages')).toBeInTheDocument();
    });

    it('registers CustomUserMessage component', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(
        screen.getByTestId('custom-user-message-registered'),
      ).toBeInTheDocument();
    });

    it('registers CustomAssistantMessage component', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(
        screen.getByTestId('custom-assistant-message-registered'),
      ).toBeInTheDocument();
    });

    it('renders SessionComposer at the bottom', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      expect(screen.getByTestId('session-composer')).toBeInTheDocument();
    });

    it('renders ScrollToBottom button hidden when not scrolled', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      const btn = screen.getByLabelText('Scroll to bottom');
      expect(btn).toBeInTheDocument();
      // Not scrolled, so button should be hidden from AT
      expect(btn).toHaveAttribute('aria-hidden', 'true');
      expect(btn).toHaveAttribute('tabindex', '-1');
    });

    it('shows ScrollToBottom button when scrolled far from bottom', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      const viewport = screen.getByTestId('thread-viewport');

      // Simulate a tall scrollable area scrolled far from bottom
      Object.defineProperty(viewport, 'scrollHeight', {
        value: 2000,
        configurable: true,
      });
      Object.defineProperty(viewport, 'clientHeight', {
        value: 500,
        configurable: true,
      });
      Object.defineProperty(viewport, 'scrollTop', {
        value: 0,
        configurable: true,
      });
      fireEvent.scroll(viewport);

      const btn = screen.getByRole('button', { name: 'Scroll to bottom' });
      expect(btn).not.toHaveAttribute('aria-hidden');
      expect(btn).toHaveAttribute('tabindex', '0');
    });

    it('hides ScrollToBottom button when scrolled back near bottom', () => {
      render(<SessionThread />, { wrapper: withSessionActions() });
      const viewport = screen.getByTestId('thread-viewport');

      // First scroll far away
      Object.defineProperty(viewport, 'scrollHeight', {
        value: 2000,
        configurable: true,
      });
      Object.defineProperty(viewport, 'clientHeight', {
        value: 500,
        configurable: true,
      });
      Object.defineProperty(viewport, 'scrollTop', {
        value: 0,
        configurable: true,
      });
      fireEvent.scroll(viewport);

      // Now scroll back near bottom (distance = 50, below threshold)
      Object.defineProperty(viewport, 'scrollTop', {
        value: 1450,
        configurable: true,
      });
      fireEvent.scroll(viewport);

      const btn = screen.getByLabelText('Scroll to bottom');
      expect(btn).toHaveAttribute('aria-hidden', 'true');
      expect(btn).toHaveAttribute('tabindex', '-1');
    });

    it('calls scrollToBottom with smooth behavior when clicked', () => {
      mockScrollToBottom.mockClear();
      render(<SessionThread />, { wrapper: withSessionActions() });
      const viewport = screen.getByTestId('thread-viewport');

      // Make button visible by simulating scroll far from bottom
      Object.defineProperty(viewport, 'scrollHeight', {
        value: 2000,
        configurable: true,
      });
      Object.defineProperty(viewport, 'clientHeight', {
        value: 500,
        configurable: true,
      });
      Object.defineProperty(viewport, 'scrollTop', {
        value: 0,
        configurable: true,
      });
      fireEvent.scroll(viewport);

      fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }));
      expect(mockScrollToBottom).toHaveBeenCalledWith({
        behavior: 'smooth',
      });
    });
  });

  describe('ThinkingIndicator', () => {
    it('shows a thinking indicator when session is running', () => {
      render(<SessionThread />, { wrapper: withSessionActions('running') });
      // Look for "Thinking" text or a spinner element
      const thinkingEl =
        screen.queryByText(/thinking/i) ??
        screen.queryByRole('status') ??
        screen.queryByTestId('thinking-indicator');
      expect(thinkingEl).toBeInTheDocument();
    });

    it('does not show thinking indicator when session is idle', () => {
      render(<SessionThread />, { wrapper: withSessionActions('idle') });
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    });

    it('does not show thinking indicator when session is failed', () => {
      render(<SessionThread />, { wrapper: withSessionActions('failed') });
      expect(screen.queryByText(/thinking/i)).not.toBeInTheDocument();
    });
  });

  describe('smoke test', () => {
    it('renders without crashing', () => {
      expect(() =>
        render(<SessionThread />, { wrapper: withSessionActions() }),
      ).not.toThrow();
    });
  });
});
