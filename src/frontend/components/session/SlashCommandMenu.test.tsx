import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import SlashCommandMenu, { filterCommands } from './SlashCommandMenu';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const commands = ['commit', 'test', 'worktree', 'pr', 'autopilot'];

describe('SlashCommandMenu', () => {
  describe('filterCommands', () => {
    it('returns all commands when filter is empty', () => {
      expect(filterCommands(commands, '')).toEqual(commands);
    });

    it('filters by prefix case-insensitively', () => {
      expect(filterCommands(commands, 'co')).toEqual(['commit']);
      expect(filterCommands(commands, 'CO')).toEqual(['commit']);
    });

    it('returns empty array when no matches', () => {
      expect(filterCommands(commands, 'xyz')).toEqual([]);
    });

    it('matches multiple commands with same prefix', () => {
      const cmds = ['test', 'test-e2e', 'typecheck'];
      expect(filterCommands(cmds, 't')).toEqual([
        'test',
        'test-e2e',
        'typecheck',
      ]);
      expect(filterCommands(cmds, 'te')).toEqual(['test', 'test-e2e']);
    });
  });

  describe('rendering', () => {
    it('renders matching commands', () => {
      render(
        <SlashCommandMenu
          commands={commands}
          filter=""
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByText('/commit')).toBeInTheDocument();
      expect(screen.getByText('/test')).toBeInTheDocument();
      expect(screen.getByText('/worktree')).toBeInTheDocument();
    });

    it('renders nothing when no commands match filter', () => {
      const { container } = render(
        <SlashCommandMenu
          commands={commands}
          filter="xyz"
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );
      expect(container.innerHTML).toBe('');
    });

    it('highlights the selected item', () => {
      render(
        <SlashCommandMenu
          commands={commands}
          filter=""
          selectedIndex={1}
          onSelect={vi.fn()}
        />,
      );
      const options = screen.getAllByRole('option');
      expect(options[1]).toHaveAttribute('aria-selected', 'true');
      expect(options[0]).toHaveAttribute('aria-selected', 'false');
    });

    it('filters commands based on filter text', () => {
      render(
        <SlashCommandMenu
          commands={commands}
          filter="wo"
          selectedIndex={0}
          onSelect={vi.fn()}
        />,
      );
      expect(screen.getByText('/worktree')).toBeInTheDocument();
      expect(screen.queryByText('/commit')).not.toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    it('calls onSelect when a command is clicked', () => {
      const onSelect = vi.fn();
      render(
        <SlashCommandMenu
          commands={commands}
          filter=""
          selectedIndex={0}
          onSelect={onSelect}
        />,
      );
      fireEvent.mouseDown(screen.getByText('/commit'));
      expect(onSelect).toHaveBeenCalledWith('commit');
    });

    it('prevents default on mouseDown to avoid textarea blur', () => {
      const onSelect = vi.fn();
      render(
        <SlashCommandMenu
          commands={commands}
          filter=""
          selectedIndex={0}
          onSelect={onSelect}
        />,
      );
      const button = screen.getByText('/commit').closest('button');
      expect(button).not.toBeNull();
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
      });
      // biome-ignore lint/style/noNonNullAssertion: asserted non-null above
      const prevented = !button!.dispatchEvent(event);
      // The onMouseDown handler calls preventDefault
      expect(prevented).toBe(true);
    });
  });
});
