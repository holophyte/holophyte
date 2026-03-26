import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetText = vi.fn();

// Shared state for simulating composer input — lives outside the factory
// so afterEach can reset it between tests.
const _mockInput = { value: '' };

// Mock ComposerPrimitive and useComposerRuntime from @assistant-ui/react
// These simulate the real primitives with enough fidelity to test behavior
vi.mock('@assistant-ui/react', () => {
  let _onSubmit: (() => void) | null = null;

  const ComposerPrimitive = {
    Root: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <form
        data-testid="composer-root"
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          _onSubmit?.();
        }}
      >
        {children}
      </form>
    ),
    Input: ({
      placeholder,
      className,
      autoFocus,
      onSubmit,
      onKeyDown,
      disabled,
    }: {
      placeholder?: string;
      className?: string;
      autoFocus?: boolean;
      onSubmit?: () => void;
      onKeyDown?: (e: React.KeyboardEvent) => void;
      disabled?: boolean;
    }) => {
      _onSubmit = onSubmit ?? null;
      return (
        <textarea
          data-testid="composer-input"
          placeholder={placeholder}
          className={className}
          disabled={disabled}
          // biome-ignore lint/a11y/noAutofocus: test mock replicates component interface
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            _mockInput.value = e.target.value;
          }}
        />
      );
    },
    Send: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <button
        type="submit"
        data-testid="composer-send"
        className={className}
        onClick={() => _onSubmit?.()}
      >
        {children}
      </button>
    ),
  };

  return {
    ComposerPrimitive,
    useComposerRuntime: () => ({
      setText: mockSetText,
      getState: () => ({ text: _mockInput.value }),
    }),
    // Track composer text separately from DOM textarea value for useComposer
    useComposer: (selector: (s: { text: string }) => unknown) =>
      selector({ text: _mockInput.value }),
  };
});

function withSession(
  children: ReactNode,
  overrides: {
    sessionStatus?: 'idle' | 'running' | 'queued' | 'failed';
    promptSuggestion?: string | null;
    handleStop?: () => Promise<void>;
    messageQueued?: boolean;
    sendMessage?: (text: string) => Promise<void>;
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
    _mockInput.value = '';
  });

  describe('rendering', () => {
    it('renders a text input area', () => {
      render(withSession(<SessionComposer />));
      expect(screen.getByTestId('composer-input')).toBeInTheDocument();
    });

    it('renders a send button', () => {
      render(withSession(<SessionComposer />));
      expect(screen.getByTestId('composer-send')).toBeInTheDocument();
    });

    it('renders with a placeholder', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
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
      expect(screen.queryByTestId('composer-send')).not.toBeInTheDocument();
    });

    it('shows stop button when input is empty and session is queued', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'queued' }));
      expect(screen.getByLabelText('Stop session')).toBeInTheDocument();
    });

    it('shows send button when input has text while running', () => {
      _mockInput.value = 'some text';
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      expect(screen.getByTestId('composer-send')).toBeInTheDocument();
      expect(screen.queryByLabelText('Stop session')).not.toBeInTheDocument();
    });

    it('shows send button when session is idle (even if empty)', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'idle' }));
      expect(screen.getByTestId('composer-send')).toBeInTheDocument();
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
      const stopBtn = screen.getByLabelText('Stop session');
      fireEvent.click(stopBtn);
      // Wait for async handler
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
      const input = screen.getByTestId('composer-input');
      fireEvent.keyDown(input, { key: 'Enter' });
      await new Promise((r) => setTimeout(r, 0));
      expect(handleStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('input enabled state', () => {
    it('input is not disabled when session is running', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
    });

    it('input is disabled when session is failed', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'failed' }));
      const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe('input behavior', () => {
    it('accepts text input', async () => {
      const user = userEvent.setup();
      render(withSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input');
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
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute('placeholder', `${suggestion}  [tab]`);
    });

    it('shows stop placeholder when running and input is empty', () => {
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          promptSuggestion: suggestion,
        }),
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute(
        'placeholder',
        'Type a follow-up or press Enter to stop…',
      );
    });

    it('shows default placeholder when no suggestion', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute(
        'placeholder',
        'Send a follow-up to Claude… (Enter to send)',
      );
    });

    it('Tab key fills composer with suggestion text', () => {
      mockSetText.mockClear();
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(mockSetText).toHaveBeenCalledWith(suggestion);
    });

    it('Tab key does nothing when no suggestion', () => {
      mockSetText.mockClear();
      render(withSession(<SessionComposer />));
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(mockSetText).not.toHaveBeenCalled();
    });

    it('Tab key does nothing when input is not empty', () => {
      mockSetText.mockClear();
      _mockInput.value = 'partial message';
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(mockSetText).not.toHaveBeenCalled();
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
