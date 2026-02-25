import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionActionsContext } from './SessionActionsContext';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock ComposerPrimitive from @assistant-ui/react
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
    }: {
      placeholder?: string;
      className?: string;
      autoFocus?: boolean;
      onSubmit?: () => void;
    }) => {
      _onSubmit = onSubmit ?? null;
      return (
        <textarea
          data-testid="composer-input"
          placeholder={placeholder}
          className={className}
          // biome-ignore lint/a11y/noAutofocus: test mock replicates component interface
          autoFocus={autoFocus}
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

  return { ComposerPrimitive };
});

function withIdleSession(children: ReactNode) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve: vi.fn(),
        deny: vi.fn(),
        pendingApprovals: [],
        sessionStatus: 'idle',
      }}
    >
      {children}
    </SessionActionsContext.Provider>
  );
}

function withRunningSession(children: ReactNode) {
  return (
    <SessionActionsContext.Provider
      value={{
        approve: vi.fn(),
        deny: vi.fn(),
        pendingApprovals: [],
        sessionStatus: 'running',
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
      render(withIdleSession(<SessionComposer />));
      expect(screen.getByTestId('composer-input')).toBeInTheDocument();
    });

    it('renders a send button', () => {
      render(withIdleSession(<SessionComposer />));
      expect(screen.getByTestId('composer-send')).toBeInTheDocument();
    });

    it('renders with a placeholder', () => {
      render(withIdleSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input') as HTMLTextAreaElement;
      expect(input.placeholder).toBeTruthy();
    });

    it('renders without crashing', () => {
      expect(() => render(withIdleSession(<SessionComposer />))).not.toThrow();
    });
  });

  describe('disabled state when running', () => {
    it('applies disabled/opacity styling when session is running', () => {
      const { container } = render(withRunningSession(<SessionComposer />));
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
      render(withIdleSession(<SessionComposer />));
      const input = screen.getByTestId('composer-input');
      await user.type(input, 'Hello Claude');
      expect((input as HTMLTextAreaElement).value).toBe('Hello Claude');
    });
  });
});
