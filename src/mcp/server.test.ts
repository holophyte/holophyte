// @vitest-environment node
//
// Tests for the Holophyte MCP server tool handlers.
//
// Strategy: before each test, use vi.doMock to register mocks, then dynamically
// import the server module so main() runs with mocked dependencies. We subclass
// McpServer to capture the instance and access _registeredTools for direct
// handler invocation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Shared mock state (persists across module reloads) ────────────────

const mockQuery = vi.fn();
const mockMutation = vi.fn();
const mockSetAuth = vi.fn();

// ── Captured server instance ──────────────────────────────────────────

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}>;

let capturedRegisteredTools:
  | Record<string, { handler: ToolHandler }>
  | undefined;

function tool(name: string): ToolHandler {
  if (!capturedRegisteredTools) {
    throw new Error('McpServer instance not captured yet');
  }
  const t = capturedRegisteredTools[name];
  if (!t) throw new Error(`Tool not registered: ${name}`);
  return t.handler;
}

// ── Per-test module setup ─────────────────────────────────────────────

beforeEach(async () => {
  vi.resetModules();
  mockQuery.mockReset();
  mockMutation.mockReset();
  mockSetAuth.mockReset();
  capturedRegisteredTools = undefined;

  // Capture McpServer instance by subclassing it
  vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', async () => {
    const actual = await vi.importActual<
      typeof import('@modelcontextprotocol/sdk/server/mcp.js')
    >('@modelcontextprotocol/sdk/server/mcp.js');

    class TrackedMcpServer extends actual.McpServer {
      constructor(...args: ConstructorParameters<typeof actual.McpServer>) {
        super(...args);
        capturedRegisteredTools = (
          this as unknown as {
            _registeredTools: Record<string, { handler: ToolHandler }>;
          }
        )._registeredTools;
      }
    }

    return { ...actual, McpServer: TrackedMcpServer };
  });

  // StdioServerTransport: prevent stdin/stdout binding
  vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: function StdioServerTransport() {
      return {
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        onmessage: null,
        onclose: null,
        onerror: null,
        send: vi.fn().mockResolvedValue(undefined),
      };
    },
  }));

  // ConvexHttpClient: must use a regular function (not arrow) to support `new`
  vi.doMock('convex/browser', () => ({
    ConvexHttpClient: function ConvexHttpClient() {
      return {
        query: mockQuery,
        mutation: mockMutation,
        setAuth: mockSetAuth,
      };
    },
  }));

  const mod = await import('./server');
  mod.__setMcpServerStateForTests({
    client: {
      query: mockQuery,
      mutation: mockMutation,
      setAuth: mockSetAuth,
    } as unknown as import('convex/browser').ConvexHttpClient,
    defaultOrgId: 'org123' as never,
  });
});

afterEach(() => {
  vi.resetModules();
});

// ── holophyte_list_repos ──────────────────────────────────────────────

describe('holophyte_list_repos', () => {
  it('calls api.repos.list with default orgId when no orgId arg provided', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'r1', name: 'my-repo', path: '/Users/ko/my-repo' },
    ]);

    const result = await tool('holophyte_list_repos')({});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org123' }),
    );
    expect(result.content[0]?.text).toContain('my-repo');
  });

  it('calls api.repos.list with provided orgId', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'r2', name: 'other-repo', path: '/other' },
    ]);

    await tool('holophyte_list_repos')({ orgId: 'org456' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org456' }),
    );
  });

  it('formats repos as JSON with id, name, path fields only', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 'r1',
        name: 'repo-name',
        path: '/some/path',
        extra: 'should-be-ignored',
      },
    ]);

    const result = await tool('holophyte_list_repos')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      id: 'r1',
      name: 'repo-name',
      path: '/some/path',
    });
  });
});

// ── holophyte_list_tasks ──────────────────────────────────────────────

describe('holophyte_list_tasks', () => {
  it('calls api.tasks.listAll with orgId when no repoId provided', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't1',
        title: 'Task 1',
        status: 'backlog',
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
    ]);

    await tool('holophyte_list_tasks')({ orgId: 'org123' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org123', includeArchived: false }),
    );
  });

  it('calls api.tasks.listByRepo when repoId is provided', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't2',
        title: 'Repo Task',
        status: 'todo',
        repoId: 'r2',
        priority: null,
        prompt: null,
      },
    ]);

    await tool('holophyte_list_tasks')({ repoId: 'r2' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repoId: 'r2', includeArchived: false }),
    );
  });

  it('filters tasks by status when status arg is provided', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't1',
        title: 'Backlog Task',
        status: 'backlog',
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't2',
        title: 'Todo Task',
        status: 'todo',
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't3',
        title: 'Done Task',
        status: 'done',
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
    ]);

    const result = await tool('holophyte_list_tasks')({
      orgId: 'org123',
      status: 'todo',
    });
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.title).toBe('Todo Task');
  });

  it('returns all tasks when no status filter provided', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't1',
        title: 'A',
        status: 'backlog',
        position: 2,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't2',
        title: 'B',
        status: 'todo',
        position: 1,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
    ]);

    const result = await tool('holophyte_list_tasks')({ orgId: 'org123' });
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(2);
  });

  it('includes position and sorts tasks by board order', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't-done',
        title: 'Done later',
        status: 'done',
        position: 10,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't-backlog-2',
        title: 'Backlog second',
        status: 'backlog',
        position: 2,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't-backlog-1',
        title: 'Backlog first',
        status: 'backlog',
        position: 1,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't-todo',
        title: 'Todo first',
        status: 'todo',
        position: 3,
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
    ]);

    const result = await tool('holophyte_list_tasks')({ orgId: 'org123' });
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed.map((t: { id: string }) => t.id)).toEqual([
      't-backlog-1',
      't-backlog-2',
      't-todo',
      't-done',
    ]);
    expect(parsed[0]?.position).toBe(1);
    expect(parsed[1]?.position).toBe(2);
  });

  it('truncates long prompts to 100 chars with ellipsis', async () => {
    const longPrompt = 'x'.repeat(150);
    mockQuery.mockResolvedValueOnce([
      {
        _id: 't1',
        title: 'Task',
        status: 'backlog',
        repoId: 'r1',
        priority: null,
        prompt: longPrompt,
      },
    ]);

    const result = await tool('holophyte_list_tasks')({ orgId: 'org123' });
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed[0]?.prompt).toBe(`${'x'.repeat(100)}...`);
  });

  it('passes includeArchived=true when specified', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await tool('holophyte_list_tasks')({
      orgId: 'org123',
      includeArchived: true,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ includeArchived: true }),
    );
  });
});

// ── holophyte_get_task ────────────────────────────────────────────────

describe('holophyte_get_task', () => {
  it('returns error response when task is not found', async () => {
    mockQuery.mockResolvedValueOnce(null);

    const result = await tool('holophyte_get_task')({ id: 'nonexistent' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Task not found');
  });

  it('returns task details as JSON when task exists', async () => {
    const mockTask = {
      _id: 'task1',
      title: 'My Task',
      description: 'desc',
      prompt: 'do this',
      status: 'todo',
      position: 4,
      priority: 'high',
      repoId: 'r1',
      repo: { name: 'my-repo', path: '/path' },
      labels: [{ _id: 'l1', name: 'bug', color: 'red' }],
      subtaskTotal: 3,
      subtaskCompleted: 1,
      createdAt: 1000,
      updatedAt: 2000,
    };
    mockQuery.mockResolvedValueOnce(mockTask);

    const result = await tool('holophyte_get_task')({ id: 'task1' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');

    expect(parsed.id).toBe('task1');
    expect(parsed.title).toBe('My Task');
    expect(parsed.position).toBe(4);
    expect(parsed.repoName).toBe('my-repo');
    expect(parsed.repoPath).toBe('/path');
    expect(parsed.labels).toHaveLength(1);
    expect(parsed.labels[0]?.name).toBe('bug');
  });
});

// ── holophyte_create_task ─────────────────────────────────────────────

describe('holophyte_create_task', () => {
  it('calls api.tasks.create with correct args', async () => {
    mockMutation.mockResolvedValueOnce('new-task-id');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'New Task',
      prompt: 'do something',
      status: 'todo',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        repoId: 'r1',
        title: 'New Task',
        prompt: 'do something',
        status: 'todo',
      }),
    );
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.id).toBe('new-task-id');
    expect(parsed.title).toBe('New Task');
  });

  it('returns backlog as default status when no status provided', async () => {
    mockMutation.mockResolvedValueOnce('task2');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Minimal Task',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.status).toBe('backlog');
  });

  it('passes priority to api.tasks.create mutation', async () => {
    mockMutation.mockResolvedValueOnce('task-p1');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'High Priority Task',
      priority: 'high',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ priority: 'high' }),
    );
  });

  it('passes labels as labelIds to api.tasks.create mutation', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValueOnce('task-l1');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Labelled Task',
      labels: ['j57labela', 'j57labelb'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ['j57labela', 'j57labelb'] }),
    );
  });

  it('passes both priority and labels when both are provided', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValueOnce('task-pl1');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Full Task',
      priority: 'urgent',
      labels: ['j57labelx'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        priority: 'urgent',
        labelIds: ['j57labelx'],
      }),
    );
  });

  it('passes priority and labelIds as undefined when not provided', async () => {
    mockMutation.mockResolvedValueOnce('task-min');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Minimal Task No Priority',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        priority: undefined,
        labelIds: undefined,
      }),
    );
  });

  it('response includes priority field defaulting to "none" when not provided', async () => {
    mockMutation.mockResolvedValueOnce('task-np');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'No Priority Task',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.priority).toBe('none');
  });

  it('response includes priority from arg when provided', async () => {
    mockMutation.mockResolvedValueOnce('task-mp');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Medium Priority',
      priority: 'medium',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.priority).toBe('medium');
  });

  it('response includes labelIds array defaulting to empty when not provided', async () => {
    mockMutation.mockResolvedValueOnce('task-nl');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'No Labels Task',
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.labelIds).toEqual([]);
  });

  it('response includes labelIds array from arg when provided', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValueOnce('task-wl');

    const result = await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'With Labels Task',
      labels: ['l1', 'l2', 'l3'],
    });

    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.labelIds).toEqual(['l1', 'l2', 'l3']);
  });
});

// ── holophyte_update_task ─────────────────────────────────────────────

describe('holophyte_update_task', () => {
  it('calls api.tasks.update when title changes', async () => {
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      title: 'Updated Title',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', title: 'Updated Title' }),
    );
  });

  it('calls both api.tasks.update and api.tasks.move when status changes', async () => {
    // First query call: get task for status move
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      repoId: 'r1',
      status: 'backlog',
      position: 0,
    });
    // Second query call: list tasks in target status column
    mockQuery.mockResolvedValueOnce([
      { _id: 'task1', status: 'done', position: 5 },
      { _id: 'task2', status: 'done', position: 10 },
    ]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      title: 'New Title',
      status: 'done',
    });

    // update called for title change
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', title: 'New Title' }),
    );
    // move called with position = max + 1 = 11
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', status: 'done', position: 11 }),
    );
  });

  it('does not call api.tasks.update when only status changes', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      repoId: 'r1',
      status: 'backlog',
      position: 0,
    });
    mockQuery.mockResolvedValueOnce([
      { _id: 'task1', status: 'todo', position: 1 },
    ]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({ id: 'task1', status: 'todo' });

    // Only one mutation call (the move), not the update
    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', status: 'todo' }),
    );
  });

  it('returns success message containing the task id', async () => {
    mockMutation.mockResolvedValue(undefined);

    const result = await tool('holophyte_update_task')({
      id: 'task42',
      title: 'Updated',
    });

    expect(result.content[0]?.text).toContain('task42');
    expect(result.content[0]?.text).toContain('updated successfully');
  });

  it('passes priority to api.tasks.update mutation', async () => {
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      priority: 'high',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', priority: 'high' }),
    );
  });

  it('passes position to api.tasks.update mutation for same-column reordering', async () => {
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      position: 7,
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', position: 7 }),
    );
    expect(mockMutation).toHaveBeenCalledTimes(1);
  });

  it('passes labels as labelIds to api.tasks.update mutation', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      labels: ['j57label1', 'j57label2'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task1',
        labelIds: ['j57label1', 'j57label2'],
      }),
    );
  });

  it('calls update mutation when both priority and labels are provided without status', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      priority: 'urgent',
      labels: ['l1'],
    });

    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task1',
        priority: 'urgent',
        labelIds: ['l1'],
      }),
    );
  });

  it('calls both update and move when priority, labels, and status are all provided', async () => {
    // labels.list for resolveLabels (no matching names → inputs pass through as IDs)
    mockQuery.mockResolvedValueOnce([]);
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      repoId: 'r1',
      status: 'backlog',
      position: 0,
    });
    mockQuery.mockResolvedValueOnce([
      { _id: 'other', status: 'in_progress', position: 2 },
    ]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      priority: 'medium',
      labels: ['l1'],
      status: 'in_progress',
    });

    // update called for priority + labels
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'task1',
        priority: 'medium',
        labelIds: ['l1'],
      }),
    );
    // move called for status change
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', status: 'in_progress' }),
    );
    expect(mockMutation).toHaveBeenCalledTimes(2);
  });

  it('passes an explicit position to api.tasks.move when status changes', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      repoId: 'r1',
      status: 'backlog',
      position: 0,
    });
    mockQuery.mockResolvedValueOnce([
      { _id: 'other', status: 'done', position: 10 },
    ]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      status: 'done',
      position: 3,
    });

    expect(mockMutation).toHaveBeenCalledTimes(1);
    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', status: 'done', position: 3 }),
    );
  });

  it('passes empty array as labelIds when labels is an empty array', async () => {
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      labels: [],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'task1', labelIds: [] }),
    );
  });
});

// ── holophyte_reorder_tasks ───────────────────────────────────────────

describe('holophyte_reorder_tasks', () => {
  it('calls api.tasks.bulkReorder with the provided ids', async () => {
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_reorder_tasks')({
      ids: ['task3', 'task1', 'task2'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ids: ['task3', 'task1', 'task2'] }),
    );
    expect(mockMutation).toHaveBeenCalledTimes(1);
  });

  it('returns a success message including the number of reordered tasks', async () => {
    mockMutation.mockResolvedValue(undefined);

    const result = await tool('holophyte_reorder_tasks')({
      ids: ['task1', 'task2'],
    });

    expect(result.content[0]?.text).toContain('Reordered 2 tasks successfully');
  });
});

// ── holophyte_list_labels ────────────────────────────────────────────

describe('holophyte_list_labels', () => {
  it('calls api.labels.list with default orgId when none provided', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await tool('holophyte_list_labels')({});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'org123' }),
    );
  });

  it('uses provided orgId over default org', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await tool('holophyte_list_labels')({ orgId: 'custom-org' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'custom-org' }),
    );
  });

  it('returns labels formatted with id, name, color', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'l1', name: 'bug', color: 'red', orgId: 'org123', extra: true },
      { _id: 'l2', name: 'feature', color: 'blue', orgId: 'org123' },
    ]);

    const result = await tool('holophyte_list_labels')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: 'l1', name: 'bug', color: 'red' });
    expect(parsed[1]).toEqual({ id: 'l2', name: 'feature', color: 'blue' });
  });
});

// ── holophyte_create_label ───────────────────────────────────────────

describe('holophyte_create_label', () => {
  it('calls api.labels.create with name, color, and default orgId', async () => {
    mockMutation.mockResolvedValueOnce('label-new');

    const result = await tool('holophyte_create_label')({
      name: 'urgent',
      color: '#ff0000',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'urgent',
        color: '#ff0000',
        orgId: 'org123',
      }),
    );
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');
    expect(parsed.id).toBe('label-new');
    expect(parsed.name).toBe('urgent');
    expect(parsed.color).toBe('#ff0000');
  });

  it('passes personal flag when provided', async () => {
    mockMutation.mockResolvedValueOnce('label-p');

    await tool('holophyte_create_label')({
      name: 'my-label',
      color: 'green',
      personal: true,
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ personal: true }),
    );
  });

  it('uses provided orgId over default org', async () => {
    mockMutation.mockResolvedValueOnce('label-x');

    await tool('holophyte_create_label')({
      name: 'test',
      color: 'blue',
      orgId: 'other-org',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'other-org' }),
    );
  });
});

// ── Label name resolution in create/update task ─────────────────────

describe('label name resolution', () => {
  it('resolves label names to IDs in holophyte_create_task', async () => {
    // labels.list returns available labels
    mockQuery.mockResolvedValueOnce([
      { _id: 'lid-1', name: 'bug', color: 'red' },
      { _id: 'lid-2', name: 'feature', color: 'blue' },
    ]);
    mockMutation.mockResolvedValueOnce('task-resolved');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Resolved Labels Task',
      labels: ['bug', 'feature'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ['lid-1', 'lid-2'] }),
    );
  });

  it('resolves label names case-insensitively', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'lid-1', name: 'Bug', color: 'red' },
    ]);
    mockMutation.mockResolvedValueOnce('task-ci');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'Case Insensitive',
      labels: ['BUG'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ['lid-1'] }),
    );
  });

  it('passes Convex ID-like labels through without resolution', async () => {
    mockQuery.mockResolvedValueOnce([]);
    mockMutation.mockResolvedValueOnce('task-id-passthrough');

    await tool('holophyte_create_task')({
      repoId: 'r1',
      title: 'ID Passthrough',
      labels: ['j57abc123def'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ['j57abc123def'] }),
    );
  });

  it('throws error for unresolved label names that are not valid IDs', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'lid1', name: 'bug', color: 'red' },
    ]);

    await expect(
      tool('holophyte_create_task')({
        repoId: 'r1',
        title: 'Bad Label',
        labels: ['My Typo Label!'],
      }),
    ).rejects.toThrow(/Unknown label\(s\): My Typo Label!/);
  });

  it('resolves label names to IDs in holophyte_update_task', async () => {
    mockQuery.mockResolvedValueOnce([
      { _id: 'lid-3', name: 'wontfix', color: 'gray' },
    ]);
    mockMutation.mockResolvedValue(undefined);

    await tool('holophyte_update_task')({
      id: 'task1',
      labels: ['wontfix'],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ labelIds: ['lid-3'] }),
    );
  });
});

// ── holophyte_get_session ─────────────────────────────────────────────

describe('holophyte_get_session', () => {
  it('returns error response when session is not found', async () => {
    mockQuery.mockResolvedValueOnce(null);

    const result = await tool('holophyte_get_session')({ id: 'nosession' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Session not found');
  });

  it('returns session details as JSON when session exists', async () => {
    const mockSession = {
      _id: 'sess1',
      taskId: 'task1',
      status: 'running',
      model: 'claude-haiku-4',
      permissionMode: 'auto',
      startedAt: 1000,
      lastActivityAt: 2000,
      sdkSessionId: 'sdk-abc',
    };
    mockQuery.mockResolvedValueOnce(mockSession);

    const result = await tool('holophyte_get_session')({ id: 'sess1' });
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');

    expect(parsed.id).toBe('sess1');
    expect(parsed.status).toBe('running');
    expect(parsed.model).toBe('claude-haiku-4');
    expect(parsed.sdkSessionId).toBe('sdk-abc');
  });
});

// ── holophyte_launch_session ──────────────────────────────────────────

describe('holophyte_launch_session', () => {
  it('returns error when task is not found', async () => {
    mockQuery.mockResolvedValueOnce(null);

    const result = await tool('holophyte_launch_session')({
      taskId: 'nonexistent',
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe('Task not found');
  });

  it('returns error when task has no prompt and none provided', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      title: 'No Prompt Task',
      prompt: undefined,
      repoId: 'r1',
    });

    const result = await tool('holophyte_launch_session')({ taskId: 'task1' });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('No prompt provided');
  });

  it('creates session using explicitly provided prompt when task has none', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      title: 'No Prompt Task',
      prompt: null,
      repoId: 'r1',
    });
    // companion status check (online)
    mockQuery.mockResolvedValueOnce({ lastSeen: Date.now() });
    mockMutation.mockResolvedValueOnce('session-123');

    const result = await tool('holophyte_launch_session')({
      taskId: 'task1',
      prompt: 'explicit prompt',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'task1', prompt: 'explicit prompt' }),
    );
    expect(result.content[0]?.text).toContain('session-123');
  });

  it('creates session using task prompt when no explicit prompt provided', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      prompt: 'task prompt text',
      repoId: 'r1',
    });
    mockQuery.mockResolvedValueOnce({ lastSeen: Date.now() });
    mockMutation.mockResolvedValueOnce('session-xyz');

    await tool('holophyte_launch_session')({ taskId: 'task1' });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ prompt: 'task prompt text' }),
    );
  });

  it('warns when companion lastSeen is more than 30 seconds ago', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      prompt: 'do work',
      repoId: 'r1',
    });
    // companion offline — lastSeen 60 seconds ago
    mockQuery.mockResolvedValueOnce({ lastSeen: Date.now() - 60_000 });
    mockMutation.mockResolvedValueOnce('session-abc');

    const result = await tool('holophyte_launch_session')({ taskId: 'task1' });

    expect(result.content[0]?.text).toContain(
      'Warning: Companion process appears offline',
    );
  });

  it('passes model arg to session creation', async () => {
    mockQuery.mockResolvedValueOnce({
      _id: 'task1',
      prompt: 'do it',
      repoId: 'r1',
    });
    mockQuery.mockResolvedValueOnce({ lastSeen: Date.now() });
    mockMutation.mockResolvedValueOnce('s1');

    await tool('holophyte_launch_session')({
      taskId: 'task1',
      model: 'claude-opus-4',
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ model: 'claude-opus-4' }),
    );
  });
});

// ── holophyte_stop_session ────────────────────────────────────────────

describe('holophyte_stop_session', () => {
  it('calls api.sessions.requestStop with the session id', async () => {
    mockMutation.mockResolvedValueOnce(undefined);

    const result = await tool('holophyte_stop_session')({ id: 'sess1' });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'sess1' }),
    );
    expect(result.content[0]?.text).toContain('sess1');
  });
});

// ── holophyte_list_templates ──────────────────────────────────────────

describe('holophyte_list_templates', () => {
  it('calls api.promptTemplates.list with undefined repoId when not provided', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await tool('holophyte_list_templates')({});

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repoId: undefined }),
    );
  });

  it('calls api.promptTemplates.list with repoId when provided', async () => {
    mockQuery.mockResolvedValueOnce([]);

    await tool('holophyte_list_templates')({ repoId: 'r1' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ repoId: 'r1' }),
    );
  });

  it('returns templates formatted with id, name, content, repoId', async () => {
    mockQuery.mockResolvedValueOnce([
      {
        _id: 'tpl1',
        name: 'Fix Bug',
        content: 'fix the bug',
        repoId: 'r1',
        extra: 'ignored',
      },
    ]);

    const result = await tool('holophyte_list_templates')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual({
      id: 'tpl1',
      name: 'Fix Bug',
      content: 'fix the bug',
      repoId: 'r1',
    });
  });

  it('returns an empty array when promptTemplates.list does not return an array', async () => {
    mockQuery.mockResolvedValueOnce({ unexpected: true });

    const result = await tool('holophyte_list_templates')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toEqual([]);
  });
});

// ── holophyte_board_summary ───────────────────────────────────────────

describe('holophyte_board_summary', () => {
  it('returns correct task counts by status and running session count', async () => {
    const callCount = { value: 0 };
    mockQuery.mockImplementation(async () => {
      callCount.value++;
      // board_summary makes two parallel queries: listAll and listActive
      if (callCount.value === 1) {
        return [
          { _id: 't1', status: 'backlog' },
          { _id: 't2', status: 'backlog' },
          { _id: 't3', status: 'todo' },
          { _id: 't4', status: 'in_progress' },
          { _id: 't5', status: 'done' },
        ];
      }
      return [{ _id: 's1' }, { _id: 's2' }];
    });

    const result = await tool('holophyte_board_summary')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');

    expect(parsed.totalTasks).toBe(5);
    expect(parsed.byStatus.backlog).toBe(2);
    expect(parsed.byStatus.todo).toBe(1);
    expect(parsed.byStatus.in_progress).toBe(1);
    expect(parsed.byStatus.done).toBe(1);
    expect(parsed.runningSessions).toBe(2);
  });

  it('uses provided orgId over default org', async () => {
    mockQuery.mockResolvedValue([]);

    await tool('holophyte_board_summary')({ orgId: 'custom-org' });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ orgId: 'custom-org' }),
    );
  });

  it('returns zero counts when no tasks or sessions', async () => {
    mockQuery.mockResolvedValue([]);

    const result = await tool('holophyte_board_summary')({});
    const parsed = JSON.parse(result.content[0]?.text ?? '{}');

    expect(parsed.totalTasks).toBe(0);
    expect(parsed.byStatus).toEqual({});
    expect(parsed.runningSessions).toBe(0);
  });
});

// ── bootstrapAuth behavior ────────────────────────────────────────────

describe('bootstrapAuth', () => {
  it('authenticates via API key using signInWithApiKey', async () => {
    vi.resetModules();

    const mockSetAuthFresh = vi.fn();
    const mockQueryFresh = vi
      .fn()
      .mockResolvedValue([
        { _id: 'org1', name: 'Personal', personal: true, role: 'owner' },
      ]);
    const mockSignInWithApiKey = vi.fn().mockResolvedValue({
      convexUrl: 'http://localhost:3210',
      token: 'api-key-jwt',
      refreshToken: 'api-key-refresh',
      ephemeral: true,
    });

    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: function ConvexHttpClient() {
        return {
          query: mockQueryFresh,
          mutation: vi.fn(),
          setAuth: mockSetAuthFresh,
        };
      },
    }));

    vi.doMock('@/server/auth-token', () => ({
      readApiKeyFile: vi.fn().mockResolvedValue(`holo_${'a'.repeat(64)}`),
      signInWithApiKey: mockSignInWithApiKey,
    }));

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', async () => {
      const actual = await vi.importActual<
        typeof import('@modelcontextprotocol/sdk/server/mcp.js')
      >('@modelcontextprotocol/sdk/server/mcp.js');
      return actual;
    });

    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: function StdioServerTransport() {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          onmessage: null,
          onclose: null,
          onerror: null,
          send: vi.fn().mockResolvedValue(undefined),
        };
      },
    }));

    process.env.CONVEX_URL = 'http://localhost:3210';

    const mod = await import('./server');
    await mod.main();

    expect(mockSignInWithApiKey).toHaveBeenCalledWith(
      'http://localhost:3210',
      `holo_${'a'.repeat(64)}`,
      'mcp',
    );
    expect(mockSetAuthFresh).toHaveBeenCalledWith('api-key-jwt');
  });

  it('exits with code 1 when no API key is found', async () => {
    vi.resetModules();

    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: function ConvexHttpClient() {
        return { query: vi.fn(), mutation: vi.fn(), setAuth: vi.fn() };
      },
    }));

    vi.doMock('@/server/auth-token', () => ({
      readApiKeyFile: vi.fn().mockResolvedValue(null),
      signInWithApiKey: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', async () => {
      const actual = await vi.importActual<
        typeof import('@modelcontextprotocol/sdk/server/mcp.js')
      >('@modelcontextprotocol/sdk/server/mcp.js');
      return actual;
    });

    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: function StdioServerTransport() {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          onmessage: null,
          onclose: null,
          onerror: null,
          send: vi.fn().mockResolvedValue(undefined),
        };
      },
    }));

    process.env.CONVEX_URL = 'http://localhost:3210';

    const mod = await import('./server');
    await mod.main().catch(() => undefined);

    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });

  it('exits with code 1 when API key sign-in fails', async () => {
    vi.resetModules();

    const mockExit = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: function ConvexHttpClient() {
        return { query: vi.fn(), mutation: vi.fn(), setAuth: vi.fn() };
      },
    }));

    vi.doMock('@/server/auth-token', () => ({
      readApiKeyFile: vi.fn().mockResolvedValue(`holo_${'a'.repeat(64)}`),
      signInWithApiKey: vi.fn().mockResolvedValue(null),
    }));

    vi.doMock('@modelcontextprotocol/sdk/server/mcp.js', async () => {
      const actual = await vi.importActual<
        typeof import('@modelcontextprotocol/sdk/server/mcp.js')
      >('@modelcontextprotocol/sdk/server/mcp.js');
      return actual;
    });

    vi.doMock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
      StdioServerTransport: function StdioServerTransport() {
        return {
          start: vi.fn().mockResolvedValue(undefined),
          close: vi.fn().mockResolvedValue(undefined),
          onmessage: null,
          onclose: null,
          onerror: null,
          send: vi.fn().mockResolvedValue(undefined),
        };
      },
    }));

    process.env.CONVEX_URL = 'http://localhost:3210';

    const mod = await import('./server');
    await mod.main().catch(() => undefined);

    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
  });
});
