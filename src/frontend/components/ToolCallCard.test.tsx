import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import ToolCallCard from './ToolCallCard';

describe('ToolCallCard', () => {
  describe('collapsed state (default)', () => {
    it('renders tool name in header', () => {
      render(
        <ToolCallCard toolName="Read" input={{ file_path: '/src/app.ts' }} />,
      );
      expect(screen.getByText('Read')).toBeInTheDocument();
    });

    it('renders the one-line summary for Read', () => {
      render(
        <ToolCallCard toolName="Read" input={{ file_path: 'src/server.ts' }} />,
      );
      expect(screen.getByText('src/server.ts')).toBeInTheDocument();
    });

    it('renders the one-line summary for Bash', () => {
      render(
        <ToolCallCard toolName="Bash" input={{ command: 'bun run test' }} />,
      );
      expect(screen.getByText('bun run test')).toBeInTheDocument();
    });

    it('truncates long Bash commands to 80 chars with ellipsis', () => {
      const longCmd = 'a'.repeat(90);
      render(<ToolCallCard toolName="Bash" input={{ command: longCmd }} />);
      expect(screen.getByText(`${'a'.repeat(80)}…`)).toBeInTheDocument();
    });

    it('renders Grep summary with pattern and path', () => {
      render(
        <ToolCallCard
          toolName="Grep"
          input={{ pattern: 'useSession', path: 'src/' }}
        />,
      );
      expect(screen.getByText('useSession in src/')).toBeInTheDocument();
    });

    it('renders Edit summary as file path', () => {
      render(
        <ToolCallCard
          toolName="Edit"
          input={{ file_path: 'src/manager.ts' }}
        />,
      );
      expect(screen.getByText('src/manager.ts')).toBeInTheDocument();
    });

    it('renders Write summary as file path', () => {
      render(
        <ToolCallCard toolName="Write" input={{ file_path: 'src/new.ts' }} />,
      );
      expect(screen.getByText('src/new.ts')).toBeInTheDocument();
    });

    it('renders Glob summary as pattern', () => {
      render(<ToolCallCard toolName="Glob" input={{ pattern: '**/*.ts' }} />);
      expect(screen.getByText('**/*.ts')).toBeInTheDocument();
    });

    it('does not show input details when collapsed', () => {
      render(<ToolCallCard toolName="Bash" input={{ command: 'ls' }} />);
      expect(screen.queryByText('Input')).not.toBeInTheDocument();
    });

    it('shows expand chevron (▼) when collapsed', () => {
      render(<ToolCallCard toolName="Read" input={{ file_path: 'x.ts' }} />);
      expect(screen.getByText('▼')).toBeInTheDocument();
    });
  });

  describe('expand / collapse toggle', () => {
    it('expands to show Input section on click', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard toolName="Bash" input={{ command: 'bun run test' }} />,
      );
      await user.click(screen.getByRole('button', { name: /bun run test/i }));
      expect(screen.getByText('Input')).toBeInTheDocument();
    });

    it('shows collapse chevron (▲) when expanded', async () => {
      const user = userEvent.setup();
      render(<ToolCallCard toolName="Read" input={{ file_path: 'x.ts' }} />);
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('▲')).toBeInTheDocument();
    });

    it('collapses again on second click', async () => {
      const user = userEvent.setup();
      render(<ToolCallCard toolName="Read" input={{ file_path: 'x.ts' }} />);
      const btn = screen.getByRole('button');
      await user.click(btn);
      expect(screen.getByText('Input')).toBeInTheDocument();
      await user.click(btn);
      expect(screen.queryByText('Input')).not.toBeInTheDocument();
    });

    it('shows JSON-formatted input when expanded', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard toolName="Bash" input={{ command: 'bun run test' }} />,
      );
      await user.click(screen.getByRole('button'));
      // The input pre should contain JSON with the command key
      expect(screen.getByText(/"command"/)).toBeInTheDocument();
    });
  });

  describe('result display', () => {
    it('shows Result section when result prop is provided and expanded', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard
          toolName="Bash"
          input={{ command: 'bun run test' }}
          result="All tests passed"
        />,
      );
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('Result')).toBeInTheDocument();
      expect(screen.getByText('All tests passed')).toBeInTheDocument();
    });

    it('does not show Result section when result is undefined', async () => {
      const user = userEvent.setup();
      render(<ToolCallCard toolName="Read" input={{ file_path: 'x.ts' }} />);
      await user.click(screen.getByRole('button'));
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });

    it('shows Error label (not Result) when isError is true', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard
          toolName="Bash"
          input={{ command: 'bad-cmd' }}
          result="command not found"
          isError
        />,
      );
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.queryByText('Result')).not.toBeInTheDocument();
    });

    it('applies error border styling when isError is true', () => {
      const { container } = render(
        <ToolCallCard toolName="Bash" input={{ command: 'bad' }} isError />,
      );
      // The outer div gets border-l-destructive class
      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain('border-l-destructive');
    });

    it('does not apply error border when isError is false', () => {
      const { container } = render(
        <ToolCallCard toolName="Read" input={{ file_path: 'x.ts' }} />,
      );
      const card = container.firstChild as HTMLElement;
      expect(card.className).not.toContain('border-l-destructive');
    });
  });

  describe('long result truncation', () => {
    const longResult = 'x'.repeat(2100);

    it('truncates results longer than 2000 chars by default', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard
          toolName="Read"
          input={{ file_path: 'big.ts' }}
          result={longResult}
        />,
      );
      await user.click(screen.getByRole('button'));
      expect(screen.getByText('Show more')).toBeInTheDocument();
    });

    it('expands truncated result on "Show more" click', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard
          toolName="Read"
          input={{ file_path: 'big.ts' }}
          result={longResult}
        />,
      );
      await user.click(screen.getByRole('button')); // expand card
      await user.click(screen.getByText('Show more'));
      expect(screen.getByText('Show less')).toBeInTheDocument();
    });

    it('does not show "Show more" for results within 2000 chars', async () => {
      const user = userEvent.setup();
      render(
        <ToolCallCard
          toolName="Read"
          input={{ file_path: 'small.ts' }}
          result={'y'.repeat(100)}
        />,
      );
      await user.click(screen.getByRole('button'));
      expect(screen.queryByText('Show more')).not.toBeInTheDocument();
    });
  });

  describe('tool-specific icons (smoke test: renders without crashing)', () => {
    const toolCases = [
      ['Read', { file_path: 'x.ts' }],
      ['Edit', { file_path: 'x.ts' }],
      ['Write', { file_path: 'x.ts' }],
      ['Bash', { command: 'ls' }],
      ['Grep', { pattern: 'foo' }],
      ['Glob', { pattern: '**/*.ts' }],
      ['WebFetch', { url: 'https://example.com' }],
      ['WebSearch', { query: 'bun docs' }],
      ['UnknownTool', {}],
    ] as const;

    for (const [tool, input] of toolCases) {
      it(`renders ${tool} without error`, () => {
        expect(() =>
          render(
            <ToolCallCard
              toolName={tool as string}
              input={input as Record<string, unknown>}
            />,
          ),
        ).not.toThrow();
      });
    }
  });
});
