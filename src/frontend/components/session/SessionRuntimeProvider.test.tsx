import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before the component under test is imported
// ---------------------------------------------------------------------------

// Mock @assistant-ui/react so tests don't need a real runtime
vi.mock('@assistant-ui/react', () => {
  const AssistantRuntimeProvider = ({
    children,
  }: {
    runtime: unknown;
    children: ReactNode;
  }) => <div data-testid="assistant-runtime-provider">{children}</div>;

  const useExternalStoreRuntime = vi.fn(() => ({ type: 'mock-runtime' }));

  return { AssistantRuntimeProvider, useExternalStoreRuntime };
});

// Mock sdkToThreadMessages
vi.mock('@/frontend/lib/sdkToThreadMessages', () => ({
  sdkToThreadMessages: vi.fn(() => []),
  extractPromptSuggestion: vi.fn(() => null),
}));

import { useExternalStoreRuntime } from '@assistant-ui/react';
import SessionRuntimeProvider from './SessionRuntimeProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProps(
  overrides: Partial<React.ComponentProps<typeof SessionRuntimeProvider>> = {},
) {
  return {
    sessionId: 'session-1',
    events: [],
    pendingApprovals: [],
    sessionStatus: 'idle' as const,
    projectCommands: [],
    approve: vi.fn(),
    deny: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    children: <div />,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SessionRuntimeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useExternalStoreRuntime as ReturnType<typeof vi.fn>).mockReturnValue({
      type: 'mock-runtime',
    });
  });

  describe('rendering', () => {
    it('renders children inside AssistantRuntimeProvider', () => {
      render(
        <SessionRuntimeProvider {...makeProps()}>
          <div data-testid="child">hello</div>
        </SessionRuntimeProvider>,
      );
      expect(
        screen.getByTestId('assistant-runtime-provider'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    it('renders multiple children', () => {
      render(
        <SessionRuntimeProvider {...makeProps()}>
          <span data-testid="a">A</span>
          <span data-testid="b">B</span>
        </SessionRuntimeProvider>,
      );
      expect(screen.getByTestId('a')).toBeInTheDocument();
      expect(screen.getByTestId('b')).toBeInTheDocument();
    });
  });

  describe('runtime adapter', () => {
    it('calls useExternalStoreRuntime to create the adapter', () => {
      render(<SessionRuntimeProvider {...makeProps()} />);
      expect(useExternalStoreRuntime).toHaveBeenCalled();
    });

    it('passes an adapter with isRunning false when status is idle', () => {
      render(
        <SessionRuntimeProvider {...makeProps({ sessionStatus: 'idle' })} />,
      );
      const callArg = (useExternalStoreRuntime as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(callArg).toBeDefined();
      expect(callArg.isRunning).toBe(false);
    });

    it('passes an adapter with messages array', () => {
      render(<SessionRuntimeProvider {...makeProps()} />);
      const callArg = (useExternalStoreRuntime as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(Array.isArray(callArg.messages)).toBe(true);
    });

    it('adapter.onNew is a function', () => {
      render(<SessionRuntimeProvider {...makeProps()} />);
      const callArg = (useExternalStoreRuntime as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(typeof callArg.onNew).toBe('function');
    });
  });

  describe('SessionActionsContext provision', () => {
    it('renders children without throwing (SessionActionsContext is provided)', () => {
      expect(() =>
        render(
          <SessionRuntimeProvider {...makeProps()}>
            <div>child</div>
          </SessionRuntimeProvider>,
        ),
      ).not.toThrow();
    });
  });

  describe('isRunning derivation', () => {
    it('passes isRunning=true when session status is running', () => {
      render(
        <SessionRuntimeProvider {...makeProps({ sessionStatus: 'running' })} />,
      );
      const callArg = (useExternalStoreRuntime as ReturnType<typeof vi.fn>).mock
        .calls[0]?.[0];
      expect(callArg.isRunning).toBe(true);
    });
  });
});
