import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetText = vi.fn();

// Mock ComposerPrimitive and useComposerRuntime from @assistant-ui/react
// These simulate the real primitives with enough fidelity to test behavior
vi.mock('@assistant-ui/react', () => {
  // Shared state for simulating composer input across the mocked primitives
  let _inputValue = '';
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
    }: {
      placeholder?: string;
      className?: string;
      autoFocus?: boolean;
      onSubmit?: () => void;
      onKeyDown?: (e: React.KeyboardEvent) => void;
    }) => {
      _onSubmit = onSubmit ?? null;
      return (
        <textarea
          data-testid="composer-input"
          placeholder={placeholder}
          className={className}
          // biome-ignore lint/a11y/noAutofocus: test mock replicates component interface
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onChange={(e) => {
            _inputValue = e.target.value;
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
    useComposerRuntime: () => ({ setText: mockSetText }),
  };
});

function withSession(
  children: ReactNode,
  overrides: {
    sessionStatus?: 'idle' | 'running';
    promptSuggestion?: string | null;
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

  describe('disabled state when running', () => {
    it('applies disabled/opacity styling when session is running', () => {
      const { container } = render(
        withSession(<SessionComposer />, { sessionStatus: 'running' }),
      );
      // Either the input is disabled or a wrapper has an opacity/disabled class
      const input = container.querySelector(
        '[data-testid="composer-input"]',
      ) as HTMLElement;
      const sendBtn = container.querySelector(
        '[data-testid="composer-send"]',
      ) as HTMLElement;
      // At least one of: input disabled, send button disabled, or visual disabled hint
      const isDisabled =
        (input as HTMLInputElement | null)?.disabled ||
        (sendBtn as HTMLButtonElement | null)?.disabled ||
        container.querySelector('[disabled]') !== null ||
        container.querySelector('[class*="opacity"]') !== null ||
        container.querySelector('[class*="disabled"]') !== null;
      expect(isDisabled).toBe(true);
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

  describe('suggestion chip', () => {
    const suggestion = 'Run the test suite';

    it('renders chip when session is idle and promptSuggestion is non-null', () => {
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      expect(screen.getByText(suggestion)).toBeInTheDocument();
    });

    it('does NOT render chip when session is running (even with non-empty suggestion)', () => {
      render(
        withSession(<SessionComposer />, {
          sessionStatus: 'running',
          promptSuggestion: suggestion,
        }),
      );
      expect(screen.queryByText(suggestion)).not.toBeInTheDocument();
    });

    it('does NOT render chip when promptSuggestion is null', () => {
      render(withSession(<SessionComposer />));
      // no chip button beyond the send button
      const buttons = screen.getAllByRole('button');
      // Only the send button should be present
      expect(buttons).toHaveLength(1);
      expect(screen.getByTestId('composer-send')).toBeInTheDocument();
    });

    it('clicking chip calls setText with the suggestion text', async () => {
      const user = userEvent.setup();
      mockSetText.mockClear();
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const chip = screen
        .getByText(suggestion)
        .closest('button') as HTMLElement;
      await user.click(chip);
      expect(mockSetText).toHaveBeenCalledWith(suggestion);
    });

    it('chip is dismissed after clicking it', async () => {
      const user = userEvent.setup();
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const chip = screen
        .getByText(suggestion)
        .closest('button') as HTMLElement;
      await user.click(chip);
      expect(screen.queryByText(suggestion)).toBeNull();
    });

    it('chip shows Tab hint', () => {
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      expect(screen.getByText('Tab')).toBeInTheDocument();
    });

    it('Tab key accepts suggestion and fills composer', () => {
      mockSetText.mockClear();
      render(
        withSession(<SessionComposer />, { promptSuggestion: suggestion }),
      );
      const input = screen.getByRole('textbox');
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(mockSetText).toHaveBeenCalledWith(suggestion);
      expect(screen.queryByText(suggestion)).toBeNull();
    });
  });
});
