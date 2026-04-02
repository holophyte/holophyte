import { TaskPriority, TaskStatus } from '@convex/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockNavigate = vi.fn();
const mockTask = {
  _id: 'task-1',
  _creationTime: 0,
  title: 'Task title',
  description: 'Task description',
  prompt: 'Implement the thing',
  status: TaskStatus.Todo,
  repoId: 'repo-1',
  labelIds: [],
  labels: [],
  priority: TaskPriority.None,
  dueAt: undefined,
  inProgressSince: undefined,
  totalInProgressMs: 0,
  promptHistoryCount: 0,
  position: 1,
  repo: {
    _id: 'repo-1',
    _creationTime: 0,
    name: 'Repo',
    path: '/tmp/repo',
  },
} as const;

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ repoId: 'repo-1', taskId: 'task-1' }),
}));

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
  useQuery: () => mockTask,
}));

vi.mock('./ClaudeButton', () => ({
  ClaudeButton: () => <div>Claude button</div>,
}));

vi.mock('./LabelPicker', () => ({
  LabelDots: () => null,
  LabelPicker: () => <div>Label picker</div>,
}));

vi.mock('./PromptHistory', () => ({
  PromptHistory: () => <div>Prompt history</div>,
}));

vi.mock('./PromptTemplatePicker', () => ({
  PromptTemplatePicker: () => <div>Prompt templates</div>,
}));

vi.mock('./SubtaskList', () => ({
  SubtaskList: () => <div>Subtasks</div>,
}));

import TaskDetailPanel from './TaskDetailPanel';

describe('TaskDetailPanel', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  it('closes when clicking the board backdrop', () => {
    render(
      <>
        <div data-testid="board-background">Board background</div>
        <TaskDetailPanel />
      </>,
    );

    fireEvent.mouseDown(screen.getByTestId('board-background'));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/repos/$repoId',
      params: { repoId: 'repo-1' },
    });
  });

  it('does not close when clicking another task card', () => {
    render(
      <>
        <div data-task-id="task-2">
          <button type="button">Another task</button>
        </div>
        <TaskDetailPanel />
      </>,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Another task' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not close when clicking inside a task detail portal', () => {
    render(
      <>
        <div data-task-detail-portal="">
          <button type="button">Portal action</button>
        </div>
        <TaskDetailPanel />
      </>,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Portal action' }));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('closes on Escape when focus is not in an editable control', () => {
    render(<TaskDetailPanel />);

    fireEvent.keyDown(
      screen.getByRole('button', { name: /close task details/i }),
      {
        key: 'Escape',
      },
    );

    expect(mockNavigate).toHaveBeenCalledWith({
      to: '/repos/$repoId',
      params: { repoId: 'repo-1' },
    });
  });

  it('does not close on Escape when focus is in a panel input', () => {
    render(<TaskDetailPanel />);

    const titleInput = screen.getByPlaceholderText('Task title');
    titleInput.focus();
    fireEvent.keyDown(titleInput, { key: 'Escape' });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not close when another handler has already prevented Escape', () => {
    render(<TaskDetailPanel />);

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.dispatchEvent(event);

    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
