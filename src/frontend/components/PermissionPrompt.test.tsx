import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PendingApproval } from '@/frontend/hooks/useSession';
import { PermissionPrompt } from './PermissionPrompt';

function makeApproval(overrides?: Partial<PendingApproval>): PendingApproval {
  return {
    requestId: 'req-1',
    tool: 'Write',
    input: { file_path: '/tmp/test.ts', content: 'hello' },
    ...overrides,
  };
}

describe('PermissionPrompt', () => {
  describe('header and description', () => {
    it('shows the tool name in the header', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({ tool: 'Write' })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(
        screen.getByText(/Permission required — Write/),
      ).toBeInTheDocument();
    });

    it('shows Write description with file path', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Write',
            input: { file_path: 'src/x.ts' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText('Write file: src/x.ts')).toBeInTheDocument();
    });

    it('shows Edit description with file path', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Edit',
            input: { file_path: 'src/y.ts' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText('Edit file: src/y.ts')).toBeInTheDocument();
    });

    it('shows Bash description with command', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Bash',
            input: { command: 'rm -rf /' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText('Run command: rm -rf /')).toBeInTheDocument();
    });

    it('shows Read description with file path', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Read',
            input: { file_path: '/etc/passwd' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText('Read file: /etc/passwd')).toBeInTheDocument();
    });

    it('shows generic description for unknown tools', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({ tool: 'SomeTool', input: {} })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText('Use SomeTool')).toBeInTheDocument();
    });
  });

  describe('input detail panel', () => {
    it('shows JSON input block for Bash tool', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Bash',
            input: { command: 'rm -rf /' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText(/"command"/)).toBeInTheDocument();
    });

    it('shows JSON input block for Edit tool', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Edit',
            input: { file_path: 'x.ts' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText(/"file_path"/)).toBeInTheDocument();
    });

    it('shows JSON input block for Write tool', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Write',
            input: { file_path: 'x.ts' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByText(/"file_path"/)).toBeInTheDocument();
    });

    it('does not show JSON input block for Read tool', () => {
      render(
        <PermissionPrompt
          approval={makeApproval({
            tool: 'Read',
            input: { file_path: 'x.ts' },
          })}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      // Read is not in the Bash/Edit/Write set → no <pre> with JSON
      expect(screen.queryByText(/"file_path"/)).not.toBeInTheDocument();
    });
  });

  describe('Approve button', () => {
    it('renders Approve button', () => {
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });

    it('calls onApprove when Approve is clicked', async () => {
      const onApprove = vi.fn();
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={onApprove}
          onDeny={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /approve/i }));
      expect(onApprove).toHaveBeenCalledOnce();
    });
  });

  describe('Deny flow', () => {
    it('renders Deny button initially', () => {
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    });

    it('clicking Deny reveals the reason input and Confirm/Cancel buttons', async () => {
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      expect(
        screen.getByPlaceholderText('Reason (optional)'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /confirm deny/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /cancel/i }),
      ).toBeInTheDocument();
    });

    it('hides Approve/Deny buttons once Deny is clicked', async () => {
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      expect(
        screen.queryByRole('button', { name: /^approve$/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^deny$/i }),
      ).not.toBeInTheDocument();
    });

    it('calls onDeny with reason text on Confirm deny', async () => {
      const onDeny = vi.fn();
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={onDeny}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.type(
        screen.getByPlaceholderText('Reason (optional)'),
        'Too risky',
      );
      await user.click(screen.getByRole('button', { name: /confirm deny/i }));
      expect(onDeny).toHaveBeenCalledWith('Too risky');
    });

    it('calls onDeny with undefined when reason is empty', async () => {
      const onDeny = vi.fn();
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={onDeny}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.click(screen.getByRole('button', { name: /confirm deny/i }));
      expect(onDeny).toHaveBeenCalledWith(undefined);
    });

    it('submits deny on Enter key in reason input', async () => {
      const onDeny = vi.fn();
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={onDeny}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.type(
        screen.getByPlaceholderText('Reason (optional)'),
        'No way{Enter}',
      );
      expect(onDeny).toHaveBeenCalledWith('No way');
    });

    it('cancels deny on Escape key and restores Approve/Deny buttons', async () => {
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.keyboard('{Escape}');
      expect(
        screen.queryByPlaceholderText('Reason (optional)'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });

    it('cancels deny on Cancel button click', async () => {
      const user = userEvent.setup();
      render(
        <PermissionPrompt
          approval={makeApproval()}
          onApprove={vi.fn()}
          onDeny={vi.fn()}
        />,
      );
      await user.click(screen.getByRole('button', { name: /^deny$/i }));
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(
        screen.queryByPlaceholderText('Reason (optional)'),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });
  });

  describe('multiple pending approvals stacked', () => {
    it('renders multiple PermissionPrompt instances independently', () => {
      const approvals: PendingApproval[] = [
        { requestId: 'req-1', tool: 'Write', input: { file_path: 'a.ts' } },
        { requestId: 'req-2', tool: 'Bash', input: { command: 'rm -rf /' } },
      ];
      render(
        <>
          {approvals.map((a) => (
            <PermissionPrompt
              key={a.requestId}
              approval={a}
              onApprove={vi.fn()}
              onDeny={vi.fn()}
            />
          ))}
        </>,
      );
      expect(
        screen.getByText(/Permission required — Write/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Permission required — Bash/),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /approve/i })).toHaveLength(
        2,
      );
    });
  });
});
