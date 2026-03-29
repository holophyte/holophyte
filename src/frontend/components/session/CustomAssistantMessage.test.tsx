import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@assistant-ui/react', () => {
  const MessagePrimitive = {
    Root: ({
      children,
      className,
    }: {
      children: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="assistant-message-root" className={className}>
        {children}
      </div>
    ),
    // Content renders children — in real assistant-ui, it renders text/tool-call parts
    Content: ({
      components,
    }: {
      components?: { Text?: React.ComponentType<{ text: string }> };
    }) => {
      // Simulate rendering text parts through the Text component if provided
      const TextComponent = components?.Text;
      if (TextComponent) {
        return (
          <div data-testid="message-content">
            <TextComponent text="Rendered by assistant-ui" />
          </div>
        );
      }
      return <div data-testid="message-content" />;
    },
  };

  const useMessage = vi.fn(() => ({
    role: 'assistant',
    content: [{ type: 'text', text: 'Hello from Claude' }],
  }));

  return { MessagePrimitive, useMessage };
});

// Mock react-markdown to render text as plain content
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => (
    <div data-testid="react-markdown">{children}</div>
  ),
}));

vi.mock('rehype-highlight', () => ({ default: () => {} }));
vi.mock('remark-gfm', () => ({ default: () => {} }));
vi.mock('./toolUIs', () => ({
  ToolCallFallback: () => <div data-testid="tool-call-fallback" />,
}));

import CustomAssistantMessage from './CustomAssistantMessage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CustomAssistantMessage', () => {
  it('renders inside an assistant-message-root', () => {
    render(<CustomAssistantMessage />);
    expect(screen.getByTestId('assistant-message-root')).toBeInTheDocument();
  });

  it('renders MessagePrimitive.Content', () => {
    render(<CustomAssistantMessage />);
    expect(screen.getByTestId('message-content')).toBeInTheDocument();
  });

  it('uses a custom text renderer that wraps content in ReactMarkdown', () => {
    render(<CustomAssistantMessage />);
    // The mock Content component calls Text component with "Rendered by assistant-ui"
    // which goes through ReactMarkdown mock
    expect(screen.getByTestId('react-markdown')).toBeInTheDocument();
    expect(screen.getByText('Rendered by assistant-ui')).toBeInTheDocument();
  });

  it('renders without crashing', () => {
    expect(() => render(<CustomAssistantMessage />)).not.toThrow();
  });

  it('applies prose styling classes for markdown content', () => {
    const { container } = render(<CustomAssistantMessage />);
    // The assistant message should use prose styling somewhere in the tree
    const proseEl = container.querySelector('[class*="prose"]');
    expect(proseEl).toBeInTheDocument();
  });
});
