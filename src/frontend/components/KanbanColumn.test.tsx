// @vitest-environment jsdom
import type { Doc } from '@convex/_generated/dataModel';
import { TaskPriority, TaskStatus } from '@convex/schema';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '@/frontend/stores/app';
import type { EnrichedTask } from './KanbanBoard';
import { KanbanColumn } from './KanbanColumn';

vi.mock('convex/react', () => ({
  useMutation: () => vi.fn(),
}));

vi.mock('./TaskCard', () => ({
  TaskCard: ({ task }: { task: { _id: string; title: string } }) => (
    <div data-task-id={task._id}>{task.title}</div>
  ),
}));

function makeTask(id: string, title: string): EnrichedTask {
  return {
    _id: id as Doc<'tasks'>['_id'],
    _creationTime: Date.now(),
    title,
    description: '',
    prompt: '',
    status: TaskStatus.Todo,
    priority: TaskPriority.None,
    position: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    repoId: 'repo_1' as Doc<'tasks'>['repoId'],
    createdBy: 'user_1' as Doc<'tasks'>['createdBy'],
    dueAt: undefined,
    labelIds: [],
    inProgressSince: undefined,
    totalInProgressMs: undefined,
    archivedAt: undefined,
    promptHistoryCount: undefined,
    private: undefined,
    labels: [],
    subtaskTotal: 0,
    subtaskCompleted: 0,
  };
}

describe('KanbanColumn', () => {
  beforeEach(() => {
    useAppStore.setState({
      bulkSelectedTaskIds: [],
    });
  });

  it('renders the add button below the header and above task cards', () => {
    render(
      <KanbanColumn
        status={TaskStatus.Todo}
        label="To Do"
        tasks={[makeTask('task_1', 'First task')]}
        repoMap={new Map()}
        showRepoBadge={false}
        onAddTask={vi.fn()}
      />,
    );

    const addButton = screen.getByRole('button', { name: 'Add task to To Do' });
    const taskCard = screen.getByText('First task');

    expect(
      addButton.compareDocumentPosition(taskCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders a collapse button and calls onCollapse', () => {
    const onCollapse = vi.fn();

    render(
      <KanbanColumn
        status={TaskStatus.Todo}
        label="To Do"
        tasks={[]}
        repoMap={new Map()}
        showRepoBadge={false}
        onCollapse={onCollapse}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Collapse To Do column' }),
    );

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it('disables the add button when task creation is unavailable', () => {
    render(
      <KanbanColumn
        status={TaskStatus.Todo}
        label="To Do"
        tasks={[]}
        repoMap={new Map()}
        showRepoBadge={false}
        onAddTask={vi.fn()}
        addTaskDisabled={true}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Add task disabled for To Do' }),
    ).toBeDisabled();
  });
});
