import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetText = vi.fn();
const mockSend = vi.fn();

// Shared state for simulating composer input — lives outside the factory
// so afterEach can reset it between tests.
const _mockInput = { value: '' };

// Mock ComposerPrimitive and useComposerRuntime from @assistant-ui/react
// These simulate the real primitives with enough fidelity to test behavior
vi.mock('@assistant-ui/react', () => {
  const ComposerPrimitive = {
    Root: ({
      children,
      className,
    }: {
      children: ReactNode;
      className?: string;
    }) => (
      <form data-testid="composer-root" className={className}>
        {children}
      </form>
    ),
    Input: ({
      placeholder,
      className,
      onKeyDown,
      disabled,
    }: {
      placeholder?: string;
      className?: string;
      onKeyDown?: (e: React.KeyboardEvent) => void;
      disabled?: boolean;
      rows?: number;
    }) => {
      return (
        <textarea
          data-testid="composer-input"
          placeholder={placeholder}
          className={className}
          disabled={disabled}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            _mockInput.value = e.target.value;
          }}
        />
      );
    },
  };

  return {
    ComposerPrimitive,
    useComposerRuntime: () => ({ setText: mockSetText, send: mockSend }),
    useComposer: (selector: (s: { text: string }) => unknown) =>
      selector({ text: _mockInput.value }),
  };
});

const mockRequestStop = vi.fn().mockResolvedValue(undefined);

function withSession(
  children: ReactNode,
  overrides: {
    sessionStatus?: 'idle' | 'running' | 'queued';
    promptSuggestion?: string | null;
  } = {},
) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve: vi.fn(),
        deny: vi.fn(),
        requestStop: mockRequestStop,
        pendingApprovals: [],
        sessionStatus: overrides.sessionStatus ?? 'idle',
        promptSuggestion: overrides.promptSuggestion ?? null,
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
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders a text input area', () => {
      render(withSession(<SessionComposer />));
      expect(screen.getByTestId('composer-input')).toBeInTheDocument();
    });

    it('renders a button', () => {
      render(withSession(<SessionComposer />));
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeInTheDocument();
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

  describe('dual-purpose button', () => {
    it('shows send icon when idle with empty input', () => {
      render(withSession(<SessionComposer />));
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeInTheDocument();
    });

    it('shows stop icon when running with empty input', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      expect(
        screen.getByRole('button', { name: /stop session/i }),
      ).toBeInTheDocument();
    });

    it('shows send icon when running with text in input', () => {
      _mockInput.value = 'hello';
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeInTheDocument();
    });

    it('clicking stop calls requestStop', async () => {
      const user = userEvent.setup();
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const btn = screen.getByRole('button', { name: /stop session/i });
      await user.click(btn);
      expect(mockRequestStop).toHaveBeenCalled();
    });

    it('clicking send calls composerRuntime.send()', async () => {
      const user = userEvent.setup();
      _mockInput.value = 'hello';
      render(withSession(<SessionComposer />));
      const btn = screen.getByRole('button', { name: /send message/i });
      await user.click(btn);
      expect(mockSend).toHaveBeenCalled();
    });
  });

  describe('Enter key behavior', () => {
    it('Enter on empty input while running calls requestStop', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const input = screen.getByTestId('composer-input');
      const event = fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockRequestStop).toHaveBeenCalled();
      // Should prevent default (form submission)
      expect(event).toBe(false);
    });

    it('Enter on empty input while idle does not call requestStop', () => {
      render(withSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(mockRequestStop).not.toHaveBeenCalled();
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

    it('input is not disabled when running', () => {
      render(withSession(<SessionComposer />, { sessionStatus: 'running' }));
      const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
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

    it('shows queue placeholder when running (even with suggestion)', () => {
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          promptSuggestion: suggestion,
        }),
      );
      const input = screen.getByRole('textbox');
      expect(input).toHaveAttribute(
        'placeholder',
        'Send a follow-up to queue… (Enter to stop)',
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

  describe('up-arrow history', () => {
    it('ArrowUp on empty input sets text from history', () => {
      _mockInput.value = 'first message';
      const { rerender } = render(withSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input');

      // Simulate sending by pressing Enter with non-empty input
      fireEvent.keyDown(input, { key: 'Enter' });

      // Clear input to simulate post-send state and re-render so React state updates
      _mockInput.value = '';
      rerender(withSession(<SessionComposer />));

      // ArrowUp should recall the last sent message
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(mockSetText).toHaveBeenCalledWith('first message');
    });

    it('ArrowDown after ArrowUp restores draft', () => {
      // Send a message first
      _mockInput.value = 'sent message';
      const { rerender } = render(withSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input');
      fireEvent.keyDown(input, { key: 'Enter' });

      // Clear input and re-render
      _mockInput.value = '';
      rerender(withSession(<SessionComposer />));

      // ArrowUp to recall
      fireEvent.keyDown(input, { key: 'ArrowUp' });
      expect(mockSetText).toHaveBeenCalledWith('sent message');

      // ArrowDown to go back to draft
      mockSetText.mockClear();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      // Should restore the draft (empty string since that's what was there)
      expect(mockSetText).toHaveBeenCalledWith('');
    });
  });
});
