import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionStatus } from '@/frontend/hooks/useSession';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('use-stick-to-bottom', () => ({
  useStickToBottomContext: () => ({
    isAtBottom: true,
    scrollToBottom: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function withSession(
  children: ReactNode,
  overrides: {
    sessionStatus?: SessionStatus;
    promptSuggestion?: string | null;
    handleStop?: () => Promise<void>;
    messageQueued?: boolean;
    sendMessage?: (text: string) => Promise<void>;
    addOptimisticMessage?: (text: string) => void;
  } = {},
) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve: vi.fn(),
        deny: vi.fn(),
        pendingApprovals: [],
        sessionStatus: overrides.sessionStatus ?? 'idle',
        promptSuggestion: overrides.promptSuggestion ?? null,
        availableCommands: [],
        handleStop:
          overrides.handleStop ?? vi.fn().mockResolvedValue(undefined),
        messageQueued: overrides.messageQueued ?? false,
        sendMessage:
          overrides.sendMessage ?? vi.fn().mockResolvedValue(undefined),
        addOptimisticMessage: overrides.addOptimisticMessage ?? vi.fn(),
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

import SessionComposer from './SessionComposer';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionComposer', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders a text input area', () => {
      render(withSession(<SessionComposer />));
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('renders a send button', () => {
      render(withSession(<SessionComposer />));
      expect(screen.getByLabelText('Send message')).toBeInTheDocument();
    });

    it('renders with a placeholder', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      expect(input.placeholder).toBeTruthy();
    });

    it('renders without crashing', () => {
      expect(() => render(withSession(<SessionComposer />))).not.toThrow();
    });
  });

  describe('stop button', () => {
    it('shows stop button when input is empty and session is running', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      expect(screen.getByLabelText('Stop session')).toBeInTheDocument();
      expect(screen.queryByLabelText('Send message')).not.toBeInTheDocument();
    });

    it('shows stop button when input is empty and session is queued', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'queued' }));
      expect(screen.getByLabelText('Stop session')).toBeInTheDocument();
    });

    it('shows send button when input has text while running', async () => {
      const user = userEvent.setup();
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      await user.type(screen.getByRole('combobox'), 'some text');
      expect(screen.getByLabelText('Send message')).toBeInTheDocument();
      expect(screen.queryByLabelText('Stop session')).not.toBeInTheDocument();
    });

    it('shows send button when session is idle (even if empty)', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'idle' }));
      expect(screen.getByLabelText('Send message')).toBeInTheDocument();
      expect(screen.queryByLabelText('Stop session')).not.toBeInTheDocument();
    });

    it('stop button calls handleStop from context', async () => {
      const handleStop = vi.fn().mockResolvedValue(undefined);
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          handleStop,
        }),
      );
      fireEvent.click(screen.getByLabelText('Stop session'));
      await new Promise((r) => setTimeout(r, 0));
      expect(handleStop).toHaveBeenCalledTimes(1);
    });

    it('Enter on empty input while running calls handleStop', async () => {
      const handleStop = vi.fn().mockResolvedValue(undefined);
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          handleStop,
        }),
      );
      const input = screen.getByRole('combobox');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      expect(handleStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('input enabled state', () => {
    it('input is not disabled when session is running', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
    });

    it('input is disabled when session is failed', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'failed' }));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      expect(input.disabled).toBe(true);
    });

    it('input is disabled when session is waiting_input', () => {
      render(
        withSession(<SessionComposer />, { sessionStatus: 'waiting_input' }),
      );
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe('input behavior', () => {
    it('accepts text input', async () => {
      const user = userEvent.setup();
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('combobox');
      await user.type(input, 'Hello Claude');
      expect((input as HTMLTextAreaElement).value).toBe('Hello Claude');
    });
  });

  describe('prompt suggestion', () => {
    const suggestion = 'Run the test suite';

    it('shows suggestion as placeholder when idle with promptSuggestion', () => {
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute('placeholder', `${suggestion}  [tab]`);
    });

    it('shows stop placeholder when running and input is empty', () => {
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          promptSuggestion: suggestion,
        }),
      );
      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute(
        'placeholder',
        'Type a follow-up or press Enter to stop…',
      );
    });

    it('shows default placeholder when no suggestion', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('combobox');
      expect(input).toHaveAttribute(
        'placeholder',
        'Send a follow-up to Claude… (Enter to send)',
      );
    });

    it('Tab key fills textarea with suggestion text', () => {
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe(suggestion);
    });

    it('Tab key does nothing when no suggestion', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      const before = input.value;
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe(before);
    });

    it('Tab key does nothing when input is not empty', async () => {
      const user = userEvent.setup();
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      await user.type(input, 'partial message');
      const valueBefore = input.value;
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe(valueBefore);
    });
  });

  describe('Enter while running sends directly', () => {
    it('calls sendMessage with trimmed text when Enter is pressed with non-empty input while running', async () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          sendMessage,
        }),
      );
      const input = screen.getByRole('combobox');
      await user.type(input, 'follow-up message');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      expect(sendMessage).toHaveBeenCalledWith('follow-up message');
    });

    it('does not call sendMessage when Enter is pressed with whitespace-only text while running', async () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          sendMessage,
        }),
      );
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      // Simulate whitespace-only value
      fireEvent.change(input, { target: { value: '   ' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      // Whitespace-only trims to empty — triggers stop, not send
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it('clears textarea after sending while running', async () => {
      const user = userEvent.setup();
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      await user.type(input, 'follow-up');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      expect(input.value).toBe('');
    });

    it('logs error and does not throw when sendMessage rejects while running', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const sendMessage = vi.fn().mockRejectedValue(new Error('network error'));
      const user = userEvent.setup();
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          sendMessage,
        }),
      );
      const input = screen.getByRole('combobox');
      await user.type(input, 'some text');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to send message:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('error handling in stop', () => {
    it('logs error and does not throw when handleStop rejects', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const handleStop = vi.fn().mockRejectedValue(new Error('stop failed'));
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          handleStop,
        }),
      );
      fireEvent.click(screen.getByLabelText('Stop session'));
      await new Promise((r) => setTimeout(r, 10));
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to stop session:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });

    it('stop button is disabled while handleStop is in progress', async () => {
      let resolveStop!: () => void;
      const handleStop = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveStop = resolve;
          }),
      );
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          handleStop,
        }),
      );
      const stopBtn = screen.getByLabelText('Stop session');
      fireEvent.click(stopBtn);
      expect(stopBtn).toBeDisabled();
      resolveStop();
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  describe('arrow key history navigation', () => {
    it('ArrowUp fills input with last sent message after input is cleared', async () => {
      const sendMessage = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          sendMessage,
        }),
      );
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      await user.type(input, 'my command');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      // Input cleared after send
      expect(input.value).toBe('');
      // ArrowUp navigates to 'my command'
      fireEvent.keyDown(input, {
        key: 'ArrowUp',
        currentTarget: { selectionStart: 0, value: '' },
      });
      // selectionStart check in handler uses e.currentTarget — simulate via fireEvent
      Object.defineProperty(input, 'selectionStart', {
        value: 0,
        configurable: true,
      });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input.value).toBe('my command');
    });

    it('ArrowUp does nothing when history is empty and input is empty', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('combobox') as HTMLTextAreaElement;
      Object.defineProperty(input, 'selectionStart', {
        value: 0,
        configurable: true,
      });
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(input.value).toBe('');
    });
  });

  describe('messageQueued indicator', () => {
    it('renders queued indicator when messageQueued is true', () => {
      render(withSession(<SessionComposer />, { messageQueued: true }));
      expect(screen.getByText(/Message queued/)).toBeInTheDocument();
    });

    it('does not render queued indicator when messageQueued is false', () => {
      render(withSession(<SessionComposer />, { messageQueued: false }));
      expect(screen.queryByText(/Message queued/)).not.toBeInTheDocument();
    });
  });
});
