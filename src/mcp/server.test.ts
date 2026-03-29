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
  vi.clearAllMocks();
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

  // auth-token: prevent filesystem reads
  vi.doMock('@/server/auth-token', () => ({
    readTokenFile: vi.fn().mockResolvedValue({ status: 'missing' }),
    signInAnonymous: vi.fn().mockResolvedValue(null),
  }));

  // Ensure CONVEX_URL is set so main() doesn't exit early
  process.env.CONVEX_URL = 'http://localhost:3210';
  // Clear CONVEX_DEPLOYMENT so bootstrapAuth skips token file read
  delete process.env.CONVEX_DEPLOYMENT;
  // Clear ALLOW_ANONYMOUS_AUTH so anonymous fallback is skipped
  delete process.env.ALLOW_ANONYMOUS_AUTH;

  // Set up default org resolution — organizations.listByUser returns one org
  mockQuery.mockResolvedValue([
    {
      _id: 'org123',
      name: 'Personal',
      slug: 'personal',
      personal: true,
      role: 'owner',
    },
  ]);

  // Import the server module — this triggers main() which calls bootstrapAuth
  // and resolveDefaultOrg, then registers the transport.
  await import('./server');
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
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
      {
        _id: 't2',
        title: 'B',
        status: 'todo',
        repoId: 'r1',
        priority: null,
        prompt: null,
      },
    ]);

    const result = await tool('holophyte_list_tasks')({ orgId: 'org123' });
    const parsed = JSON.parse(result.content[0]?.text ?? '[]');

    expect(parsed).toHaveLength(2);
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
  it('sets auth token on client when stored token matches convex url', async () => {
    // Need a fresh module with deployment + token configured
    vi.resetModules();

    const mockSetAuthFresh = vi.fn();
    const mockQueryFresh = vi
      .fn()
      .mockResolvedValue([
        { _id: 'org1', name: 'Personal', personal: true, role: 'owner' },
      ]);

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
      readTokenFile: vi.fn().mockResolvedValue({
        status: 'ok',
        data: {
          convexUrl: 'http://localhost:3210',
          token: 'stored-jwt',
          refreshToken: 'stored-refresh',
        },
      }),
      signInAnonymous: vi.fn().mockResolvedValue(null),
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
    process.env.CONVEX_DEPLOYMENT = 'local-ko_vial-holophyte-9133';

    await import('./server');

    expect(mockSetAuthFresh).toHaveBeenCalledWith('stored-jwt');

    delete process.env.CONVEX_DEPLOYMENT;
  });

  it('calls signInAnonymous when token missing and ALLOW_ANONYMOUS_AUTH=1', async () => {
    vi.resetModules();

    const mockSignInAnonymous = vi.fn().mockResolvedValue({
      convexUrl: 'http://localhost:3210',
      token: 'anon-jwt',
      refreshToken: 'anon-refresh',
      ephemeral: true,
    });
    const mockSetAuthFresh = vi.fn();

    vi.doMock('@/server/auth-token', () => ({
      readTokenFile: vi.fn().mockResolvedValue({ status: 'missing' }),
      signInAnonymous: mockSignInAnonymous,
    }));

    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: function ConvexHttpClient() {
        return {
          query: vi
            .fn()
            .mockResolvedValue([
              { _id: 'org1', name: 'Personal', personal: true, role: 'owner' },
            ]),
          mutation: vi.fn(),
          setAuth: mockSetAuthFresh,
        };
      },
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
    process.env.ALLOW_ANONYMOUS_AUTH = '1';

    await import('./server');

    expect(mockSignInAnonymous).toHaveBeenCalledWith('http://localhost:3210');
    expect(mockSetAuthFresh).toHaveBeenCalledWith('anon-jwt');

    delete process.env.ALLOW_ANONYMOUS_AUTH;
  });
});
