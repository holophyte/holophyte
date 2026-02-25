import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock @assistant-ui/react MessagePrimitive — simulate hook + component behavior
vi.mock('@assistant-ui/react', () => {
  const MessagePrimitive = {
    // Render children directly (the component wraps content in this)
    Root: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="message-root" className={className}>
        {children}
      </div>
    ),
    Content: ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="message-content">{children}</div>
    ),
  };

  // useMessage returns the current message — we'll control this via vi.fn
  const useMessage = vi.fn(() => ({
    role: 'user',
    content: [{ type: 'text', text: 'Hello from user' }],
  }));

  return { MessagePrimitive, useMessage };
});

import { useMessage } from '@assistant-ui/react';
import CustomUserMessage from './CustomUserMessage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomUserMessage', () => {
  it('renders user message text', () => {
    (useMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      role: 'user',
      content: [{ type: 'text', text: 'Hello from user' }],
    });
    render(<CustomUserMessage />);
    expect(screen.getByText('Hello from user')).toBeInTheDocument();
  });

  it('renders multi-part text by joining parts', () => {
    (useMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      role: 'user',
      content: [
        { type: 'text', text: 'Part one' },
        { type: 'text', text: ' part two' },
      ],
    });
    render(<CustomUserMessage />);
    // Should show the combined text (exact rendering depends on implementation)
    expect(screen.getByText(/part one/i)).toBeInTheDocument();
  });

  it('renders inside a MessagePrimitive.Root wrapper', () => {
    render(<CustomUserMessage />);
    expect(screen.getByTestId('message-root')).toBeInTheDocument();
  });

  it('renders without crashing when content is empty', () => {
    (useMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      role: 'user',
      content: [],
    });
    expect(() => render(<CustomUserMessage />)).not.toThrow();
  });

  it('uses whitespace-pre-wrap styling for text', () => {
    (useMessage as ReturnType<typeof vi.fn>).mockReturnValue({
      role: 'user',
      content: [{ type: 'text', text: 'line1\nline2' }],
    });
    const { container } = render(<CustomUserMessage />);
    const textEl = container.querySelector('[class*="whitespace-pre-wrap"]');
    expect(textEl).toBeInTheDocument();
  });
});
