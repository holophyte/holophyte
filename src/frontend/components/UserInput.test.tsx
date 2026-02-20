import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import UserInput from './UserInput';

describe('UserInput', () => {
  describe('rendering', () => {
    it('renders the textarea', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('renders the send button', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeInTheDocument();
    });

    it('shows active placeholder when session is running', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      expect(
        screen.getByPlaceholderText(/send a message to claude/i),
      ).toBeInTheDocument();
    });

    it('shows "Session completed" placeholder when disabled', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} disabled />);
      expect(
        screen.getByPlaceholderText('Session completed'),
      ).toBeInTheDocument();
    });
  });

  describe('disabled states', () => {
    it('disables textarea when disabled prop is true', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} disabled />);
      expect(screen.getByRole('textbox')).toBeDisabled();
    });

    it('disables send button when textarea is empty', () => {
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeDisabled();
    });

    it('disables send button when sessionId is null', async () => {
      const user = userEvent.setup();
      render(<UserInput sessionId={null} onSend={vi.fn()} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeDisabled();
    });

    it('disables send button when disabled and text is present', async () => {
      const _user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={vi.fn()} disabled />);
      // Textarea is disabled so typing does nothing, but verify button stays disabled
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeDisabled();
    });

    it('enables send button when text is typed and session is active', async () => {
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).not.toBeDisabled();
    });

    it('keeps send button disabled for whitespace-only input', async () => {
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={vi.fn()} />);
      await user.type(screen.getByRole('textbox'), '   ');
      expect(
        screen.getByRole('button', { name: /send message/i }),
      ).toBeDisabled();
    });
  });

  describe('sending via button click', () => {
    it('calls onSend with sessionId and trimmed text', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<UserInput sessionId="session-abc" onSend={onSend} />);
      await user.type(screen.getByRole('textbox'), '  hello world  ');
      await user.click(screen.getByRole('button', { name: /send message/i }));
      expect(onSend).toHaveBeenCalledWith('session-abc', 'hello world');
    });

    it('clears textarea after successful send', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      await user.click(screen.getByRole('button', { name: /send message/i }));
      expect(screen.getByRole('textbox')).toHaveValue('');
    });

    it('does not call onSend when textarea is empty', async () => {
      const onSend = vi.fn();
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} />);
      await user.click(screen.getByRole('button', { name: /send message/i }));
      expect(onSend).not.toHaveBeenCalled();
    });
  });

  describe('Cmd+Enter shortcut', () => {
    it('sends on Cmd+Enter', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      expect(onSend).toHaveBeenCalledWith('s1', 'hello');
    });

    it('sends on Ctrl+Enter', async () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      await user.keyboard('{Control>}{Enter}{/Control}');
      expect(onSend).toHaveBeenCalledWith('s1', 'hello');
    });

    it('does not send on bare Enter', async () => {
      const onSend = vi.fn();
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} />);
      await user.type(screen.getByRole('textbox'), 'hello');
      await user.keyboard('{Enter}');
      // Enter should insert a newline, not send
      expect(onSend).not.toHaveBeenCalled();
    });

    it('does not send via Cmd+Enter when disabled', async () => {
      const onSend = vi.fn();
      const user = userEvent.setup();
      render(<UserInput sessionId="s1" onSend={onSend} disabled />);
      await user.keyboard('{Meta>}{Enter}{/Meta}');
      expect(onSend).not.toHaveBeenCalled();
    });
  });
});
