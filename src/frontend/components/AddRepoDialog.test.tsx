import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock config module — must be before component import
vi.mock('@/frontend/lib/config', () => ({
  homeDir: '/Users/testuser',
}));

// Mock Convex
const mockCreateRepo = vi.fn();
vi.mock('convex/react', () => ({
  useMutation: () => mockCreateRepo,
}));
vi.mock('@convex/_generated/api', () => ({
  api: { repos: { create: 'repos:create' } },
}));

// Mock Zustand store
vi.mock('@/frontend/stores/app', () => ({
  useAppStore: (selector: (s: { selectedOrgId: string }) => unknown) =>
    selector({ selectedOrgId: 'org-123' }),
}));

import { AddRepoDialog, expandTilde, nameFromPath } from './AddRepoDialog';

// ── Pure function tests ─────────────────────────────────────────────

describe('nameFromPath', () => {
  it('extracts last segment from a path', () => {
    expect(nameFromPath('/Users/ko/projects/my-repo')).toBe('my-repo');
  });

  it('strips trailing slashes', () => {
    expect(nameFromPath('/Users/ko/projects/my-repo/')).toBe('my-repo');
    expect(nameFromPath('/Users/ko/projects/my-repo///')).toBe('my-repo');
  });

  it('returns empty string for root path', () => {
    expect(nameFromPath('/')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(nameFromPath('')).toBe('');
  });

  it('handles single segment', () => {
    expect(nameFromPath('my-repo')).toBe('my-repo');
  });

  it('handles tilde paths', () => {
    expect(nameFromPath('~/projects/my-repo')).toBe('my-repo');
  });
});

describe('expandTilde', () => {
  // homeDir is mocked as '/Users/testuser'

  it('expands bare ~ to home directory', () => {
    expect(expandTilde('~')).toBe('/Users/testuser');
  });

  it('expands ~/ prefix to home directory', () => {
    expect(expandTilde('~/projects/repo')).toBe(
      '/Users/testuser/projects/repo',
    );
  });

  it('does not expand ~ in the middle of a path', () => {
    expect(expandTilde('/some/~/path')).toBe('/some/~/path');
  });

  it('leaves absolute paths unchanged', () => {
    expect(expandTilde('/Users/ko/repo')).toBe('/Users/ko/repo');
  });

  it('leaves relative paths unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path');
  });
});

// ── Component tests ─────────────────────────────────────────────────

describe('AddRepoDialog', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  afterEach(() => {
    vi.clearAllMocks();
  });

  function renderDialog() {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<AddRepoDialog open={true} onOpenChange={onOpenChange} />);
    return { onOpenChange, user };
  }

  it('renders the dialog with path and name inputs', () => {
    renderDialog();
    expect(screen.getByText('Add Repository')).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('~/projects/my-repo'),
    ).toBeInTheDocument();
    expect(screen.getByPlaceholderText('my-project')).toBeInTheDocument();
  });

  it('has a disabled submit button when fields are empty', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: 'Add Repo' })).toBeDisabled();
  });

  it('auto-fills name from typed path', async () => {
    const { user } = renderDialog();
    const pathInput = screen.getByPlaceholderText('~/projects/my-repo');
    await user.type(pathInput, '/Users/ko/my-project');
    expect(screen.getByPlaceholderText('my-project')).toHaveValue('my-project');
  });

  it('shows error for relative path on submit', async () => {
    const { user } = renderDialog();
    const pathInput = screen.getByPlaceholderText('~/projects/my-repo');
    const nameInput = screen.getByPlaceholderText('my-project');
    await user.type(pathInput, 'relative/path');
    await user.clear(nameInput);
    await user.type(nameInput, 'test');
    await user.click(screen.getByRole('button', { name: 'Add Repo' }));
    expect(
      screen.getByText('Path must be absolute (start with / or ~/).'),
    ).toBeInTheDocument();
  });

  it('expands ~ and submits to createRepo', async () => {
    mockCreateRepo.mockResolvedValueOnce('repo-id');
    const { user, onOpenChange } = renderDialog();
    const pathInput = screen.getByPlaceholderText('~/projects/my-repo');
    const nameInput = screen.getByPlaceholderText('my-project');
    await user.type(pathInput, '~/projects/my-repo');
    await user.clear(nameInput);
    await user.type(nameInput, 'my-repo');
    await user.click(screen.getByRole('button', { name: 'Add Repo' }));

    await waitFor(() => {
      expect(mockCreateRepo).toHaveBeenCalledWith({
        name: 'my-repo',
        path: '/Users/testuser/projects/my-repo',
        orgId: 'org-123',
      });
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows duplicate error from Convex', async () => {
    mockCreateRepo.mockRejectedValueOnce(
      new Error('Repo already exists at /path'),
    );
    const { user } = renderDialog();
    await user.type(
      screen.getByPlaceholderText('~/projects/my-repo'),
      '/Users/ko/repo',
    );
    await user.type(screen.getByPlaceholderText('my-project'), 'repo');
    await user.click(screen.getByRole('button', { name: 'Add Repo' }));

    await waitFor(() => {
      expect(
        screen.getByText('This repository has already been added.'),
      ).toBeInTheDocument();
    });
  });

  describe('directory picker', () => {
    it('fills path and name from picker result', async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json({
          cancelled: false,
          path: '/Users/ko/Development/holophyte',
          name: 'holophyte',
          isGitRepo: true,
        }),
      );
      const { user } = renderDialog();
      await user.click(screen.getByTitle('Browse...'));

      await waitFor(() => {
        expect(screen.getByPlaceholderText('~/projects/my-repo')).toHaveValue(
          '/Users/ko/Development/holophyte',
        );
      });
      expect(screen.getByPlaceholderText('my-project')).toHaveValue(
        'holophyte',
      );
      expect(fetchSpy).toHaveBeenCalledWith('/api/pick-directory', {
        method: 'POST',
      });
    });

    it('shows warning for non-git directories', async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json({
          cancelled: false,
          path: '/Users/ko/Documents',
          name: 'Documents',
          isGitRepo: false,
        }),
      );
      const { user } = renderDialog();
      await user.click(screen.getByTitle('Browse...'));

      await waitFor(() => {
        expect(
          screen.getByText('Selected folder is not a git repository.'),
        ).toBeInTheDocument();
      });
    });

    it('does nothing when picker is cancelled', async () => {
      fetchSpy.mockResolvedValueOnce(Response.json({ cancelled: true }));
      const { user } = renderDialog();
      await user.click(screen.getByTitle('Browse...'));

      await waitFor(() => {
        expect(fetchSpy).toHaveBeenCalled();
      });
      expect(screen.getByPlaceholderText('~/projects/my-repo')).toHaveValue('');
    });

    it('shows error when picker fails', async () => {
      fetchSpy.mockRejectedValueOnce(new Error('network error'));
      const { user } = renderDialog();
      await user.click(screen.getByTitle('Browse...'));

      await waitFor(() => {
        expect(
          screen.getByText('Failed to open directory picker.'),
        ).toBeInTheDocument();
      });
    });
  });
});
