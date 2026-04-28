// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing the manager
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock the shared Convex clients — the manager uses getConvexClient() for
// mutations and getConvexHttpClient() for one-shot queries.
const mockMutation = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue(undefined);

vi.mock('@/server/convex-client', () => ({
  getConvexClient: vi.fn(() => ({ mutation: mockMutation })),
  getConvexHttpClient: vi.fn(async () => ({ query: mockQuery })),
}));

import { query as mockSdkQuery } from '@anthropic-ai/claude-agent-sdk';
import { api } from '@convex/_generated/api';
import { getFunctionName } from 'convex/server';

afterEach(async () => {
  const { getActiveSessions, stopSession } = await import('./manager');
  for (const id of getActiveSessions()) {
    stopSession(id);
  }
  // Wait for all sessions to drain from the active map. Cleanup involves
  // async calls (flushEvents, denyAll, updateStatus) that need mock clients.
  const deadline = Date.now() + 2000;
  while (getActiveSessions().length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  mockMutation.mockClear();
  mockQuery.mockClear();
  vi.restoreAllMocks();
});

/** Helper: create a mock async generator that yields the given events. */
function createMockIterator(events: Array<Record<string, unknown>>) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const event of events) {
        yield event;
      }
    },
    next: vi.fn(),
    return: vi.fn(),
    throw: vi.fn(),
    streamInput: vi.fn().mockResolvedValue(undefined),
    supportedCommands: vi.fn().mockResolvedValue([]),
    supportedModels: vi.fn().mockResolvedValue([]),
  };
}

describe('claude/manager (SDK-based)', () => {
  describe('startSession', () => {
    it('registers the session and calls SDK query', async () => {
      const mockIter = createMockIterator([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-123',
          tools: [],
          model: 'claude-sonnet-4-5-20250929',
        },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-123',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, getSession, getActiveSessions } = await import(
        './manager'
      );

      const result = await startSession({
        sessionId: 'test-session-id',
        repoPath: '/tmp/test-repo',
        prompt: 'fix the bug',
      });

      expect(result.sessionId).toBe('test-session-id');
      expect(getSession('test-session-id')).toBeDefined();
      expect(getActiveSessions()).toContain('test-session-id');

      expect(mockSdkQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'fix the bug',
          options: expect.objectContaining({
            cwd: '/tmp/test-repo',
          }),
        }),
      );

      // Wait for iterator to complete
      await new Promise((r) => setTimeout(r, 50));
    });

    it('accepts optional model and permissionMode', async () => {
      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-456',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'test-model-session',
        repoPath: '/tmp/test-repo',
        prompt: 'test',
        model: 'claude-sonnet-4-5-20250929',
        permissionMode: 'bypass',
      });

      expect(mockSdkQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            model: 'claude-sonnet-4-5-20250929',
          }),
        }),
      );

      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('stopSession', () => {
    it('aborts the controller and marks session as idle (stop = resumable)', async () => {
      // Create a long-running iterator that throws when aborted (like the real SDK)
      let abortReject: ((err: Error) => void) | undefined;

      const mockIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-789',
            tools: [],
            model: 'claude-sonnet-4-5-20250929',
          };
          // Block until aborted, then throw like the real SDK does
          await new Promise<never>((_, reject) => {
            abortReject = reject;
          });
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, stopSession, getSession } = await import(
        './manager'
      );

      await startSession({
        sessionId: 'stop-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      const session = getSession('stop-test');
      expect(session).toBeDefined();

      // Wait for consumeIterator to reach the blocking await (where abortReject gets set)
      await new Promise((r) => setTimeout(r, 20));

      stopSession('stop-test');

      // Simulate SDK throwing AbortError when the controller is aborted
      abortReject?.(new Error('AbortError'));
      await new Promise((r) => setTimeout(r, 100));

      // Session should be cleaned up from memory
      expect(getSession('stop-test')).toBeUndefined();

      // companionUpdateStatus should have been called with 'idle'
      const statusCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'status' in (call[1] as Record<string, unknown>),
      );
      expect(statusCalls.length).toBeGreaterThan(0);
      // The last status update should be 'idle' (user-initiated stop = resumable)
      const lastStatus = statusCalls[statusCalls.length - 1];
      expect((lastStatus?.[1] as Record<string, unknown>)?.status).toBe('idle');
    });

    it('does nothing for a non-existent session', async () => {
      const { stopSession } = await import('./manager');
      stopSession('non-existent-id');
    });
  });

  describe('session lifecycle', () => {
    it('cleans up on completion and calls updateStatus with idle', async () => {
      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-lifecycle',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, getSession } = await import('./manager');

      await startSession({
        sessionId: 'lifecycle-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      // Let iterator complete
      await new Promise((r) => setTimeout(r, 100));

      // Session should be cleaned up (removed from active map)
      expect(getSession('lifecycle-test')).toBeUndefined();

      // companionUpdateStatus should have been called with 'idle'
      const statusCalls = mockMutation.mock.calls.filter(
        (call) => typeof call[1] === 'object' && call[1]?.status === 'idle',
      );
      expect(statusCalls.length).toBeGreaterThan(0);
    });

    it('calls updateStatus with failed for error results', async () => {
      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'error_during_execution',
          is_error: true,
          errors: ['Something went wrong'],
          session_id: 'sdk-error',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'error-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      // Let iterator complete
      await new Promise((r) => setTimeout(r, 100));

      // companionUpdateStatus should have been called with 'failed'
      const statusCalls = mockMutation.mock.calls.filter(
        (call) => typeof call[1] === 'object' && call[1]?.status === 'failed',
      );
      expect(statusCalls.length).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // canUseTool / permission mode behaviour
  // ---------------------------------------------------------------------------

  type CanUseTool = (
    tool: string,
    input: Record<string, unknown>,
    opts: { toolUseID: string; signal: AbortSignal },
  ) => Promise<{
    behavior: string;
    toolUseID?: string;
    message?: string;
    updatedInput?: Record<string, unknown>;
  }>;

  /** Start a session and capture the canUseTool callback from the SDK options. */
  async function captureCanUseTool(
    permissionMode: 'bypass' | 'default' | 'safe-auto',
  ): Promise<{ canUseTool: CanUseTool; sessionId: string }> {
    let captured: CanUseTool | undefined;

    vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
      const { options } = params as { options: { canUseTool: CanUseTool } };
      captured = options.canUseTool;
      return createMockIterator([]) as never;
    });

    const { startSession } = await import('./manager');
    const sessionId = `perm-test-${Math.random().toString(36).slice(2)}`;
    await startSession({
      sessionId,
      repoPath: '/tmp',
      prompt: 'test',
      permissionMode,
    });

    // Wait for consumeIterator to call sdkQuery and populate captured
    await new Promise((r) => setTimeout(r, 20));
    if (!captured)
      throw new Error('canUseTool was not captured from SDK options');
    return { canUseTool: captured, sessionId };
  }

  function sig(): AbortSignal {
    return new AbortController().signal;
  }

  describe('bypass mode: auto-approves everything', () => {
    it('allows SAFE_TOOLS, Bash, and Write', async () => {
      const { canUseTool } = await captureCanUseTool('bypass');
      expect(
        (await canUseTool('Read', {}, { toolUseID: 't1', signal: sig() }))
          .behavior,
      ).toBe('allow');
      expect(
        (
          await canUseTool(
            'Write',
            { file_path: '/etc/passwd', content: 'x' },
            { toolUseID: 't2', signal: sig() },
          )
        ).behavior,
      ).toBe('allow');
      expect(
        (
          await canUseTool(
            'Bash',
            { command: 'rm -rf /' },
            { toolUseID: 't3', signal: sig() },
          )
        ).behavior,
      ).toBe('allow');
    });
  });

  describe('default mode: queues every tool', () => {
    it('calls companionCreate for Read and Bash', async () => {
      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: {
            canUseTool: CanUseTool;
            abortController: AbortController;
          };
        };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            await Promise.all([
              options.canUseTool(
                'Read',
                {},
                {
                  toolUseID: 'r1',
                  signal: options.abortController.signal,
                },
              ),
              options.canUseTool(
                'Bash',
                { command: 'ls' },
                {
                  toolUseID: 'r2',
                  signal: options.abortController.signal,
                },
              ),
            ]);
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
          supportedCommands: vi.fn().mockResolvedValue([]),
          supportedModels: vi.fn().mockResolvedValue([]),
        } as never;
      });

      const { startSession } = await import('./manager');
      await startSession({
        sessionId: 'default-queue-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'default',
      });

      await new Promise((r) => setTimeout(r, 100));

      // companionCreate should have been called for both tools
      const createCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'requestId' in (call[1] as Record<string, unknown>),
      );
      const r1Calls = createCalls.filter(
        (c) => (c[1] as Record<string, unknown>).requestId === 'r1',
      );
      const r2Calls = createCalls.filter(
        (c) => (c[1] as Record<string, unknown>).requestId === 'r2',
      );
      expect(r1Calls.length).toBeGreaterThan(0);
      expect(r2Calls.length).toBeGreaterThan(0);
    });
  });

  describe('safe-auto mode', () => {
    it('auto-approves SAFE_TOOLS', async () => {
      const { canUseTool } = await captureCanUseTool('safe-auto');
      for (const tool of [
        'Read',
        'Glob',
        'Grep',
        'WebFetch',
        'WebSearch',
        'TodoRead',
      ]) {
        const result = await canUseTool(
          tool,
          {},
          { toolUseID: tool, signal: sig() },
        );
        expect(result.behavior, `${tool} should be auto-approved`).toBe(
          'allow',
        );
      }
    });

    it('auto-approves safe bash commands', async () => {
      const { canUseTool } = await captureCanUseTool('safe-auto');
      const safe = [
        ['ls', 's1'],
        ['ls ~/.ssh', 's2'], // tilde path — ls itself is safe
        ['pwd', 's3'],
        ['bun test', 's4'],
        ['bun run lint', 's5'],
        ['bun run check', 's6'],
        ['git status', 's7'],
        ['git branch', 's8'],
        ['git show abc1234f', 's9'],
        ['bunx vitest', 's10'],
        ['which bun', 's11'],
        ['git log', 's12'], // bare log — no patch output
        ['git log --oneline', 's13'],
        ['git log --stat', 's14'],
        ['git log -n 10', 's15'],
        ['git diff --stat', 's16'],
        ['git diff --name-only', 's17'],
      ] as const;
      for (const [cmd, id] of safe) {
        const result = await canUseTool(
          'Bash',
          { command: cmd },
          { toolUseID: id, signal: sig() },
        );
        expect(result.behavior, `"${cmd}" should be auto-approved`).toBe(
          'allow',
        );
      }
    });

    it('calls companionCreate for unsafe bash commands', async () => {
      const unsafe = [
        ['bun run dev', 'u1'], // arbitrary package.json script
        ['git branch -D main', 'u2'], // destructive flag
        ['git show HEAD:src/file.ts', 'u3'], // colon = file content exfiltration
        ['ls > /tmp/out', 'u4'], // redirect operator
        ['bun test && rm -rf /', 'u5'], // chained shell operator
        ['bunx some-random-pkg', 'u6'], // arbitrary npm exec
        ['git log -p', 'u7'], // patch output exposes full file content
        ['git log --full-diff', 'u8'], // same risk as -p
        ['git diff', 'u9'], // bare diff outputs full working-tree patch
        ['git diff HEAD~1..HEAD', 'u10'], // range args enable targeted exfiltration
        ['git diff HEAD~1..HEAD src/.env', 'u11'], // explicit secret file path
      ] as const;

      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: {
            canUseTool: CanUseTool;
            abortController: AbortController;
          };
        };
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.all(
              unsafe.map(([cmd, id]) =>
                options.canUseTool(
                  'Bash',
                  { command: cmd },
                  {
                    toolUseID: id,
                    signal: options.abortController.signal,
                  },
                ),
              ),
            );
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
          supportedCommands: vi.fn().mockResolvedValue([]),
          supportedModels: vi.fn().mockResolvedValue([]),
        } as never;
      });

      const { startSession } = await import('./manager');
      await startSession({
        sessionId: 'unsafe-bash-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'safe-auto',
      });

      await new Promise((r) => setTimeout(r, 100));

      const createCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'requestId' in (call[1] as Record<string, unknown>),
      );
      for (const [cmd, id] of unsafe) {
        const matched = createCalls.some(
          (c) => (c[1] as Record<string, unknown>).requestId === id,
        );
        expect(matched, `"${cmd}" should have called companionCreate`).toBe(
          true,
        );
      }
    });

    it('calls companionCreate for write-side tools (Write, Edit)', async () => {
      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: {
            canUseTool: CanUseTool;
            abortController: AbortController;
          };
        };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            await Promise.all([
              options.canUseTool(
                'Write',
                { file_path: '/tmp/x' },
                {
                  toolUseID: 'w1',
                  signal: options.abortController.signal,
                },
              ),
              options.canUseTool(
                'Edit',
                { file_path: '/tmp/x' },
                {
                  toolUseID: 'e1',
                  signal: options.abortController.signal,
                },
              ),
            ]);
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
          supportedCommands: vi.fn().mockResolvedValue([]),
          supportedModels: vi.fn().mockResolvedValue([]),
        } as never;
      });

      const { startSession } = await import('./manager');
      await startSession({
        sessionId: 'write-tools-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'safe-auto',
      });

      await new Promise((r) => setTimeout(r, 100));

      const createCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'requestId' in (call[1] as Record<string, unknown>),
      );
      expect(
        createCalls.some(
          (c) => (c[1] as Record<string, unknown>).requestId === 'w1',
        ),
      ).toBe(true);
      expect(
        createCalls.some(
          (c) => (c[1] as Record<string, unknown>).requestId === 'e1',
        ),
      ).toBe(true);
    });
  });

  describe('additionalDirectories (GH #247)', () => {
    it('passes /tmp to the SDK so approved Writes outside the repo succeed', async () => {
      let capturedOptions: Record<string, unknown> | undefined;
      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as { options: Record<string, unknown> };
        capturedOptions = options;
        return createMockIterator([]) as never;
      });

      const { startSession } = await import('./manager');
      await startSession({
        sessionId: `add-dir-${Math.random().toString(36).slice(2)}`,
        repoPath: '/some/repo',
        prompt: 'test',
      });
      await new Promise((r) => setTimeout(r, 20));

      expect(capturedOptions?.additionalDirectories).toEqual(
        expect.arrayContaining(['/tmp']),
      );
      // On macOS, /tmp is a symlink to /private/tmp — both should be allowed so
      // path resolution doesn't matter for the permission check.
      if (process.platform === 'darwin') {
        expect(capturedOptions?.additionalDirectories).toEqual(
          expect.arrayContaining(['/private/tmp']),
        );
      }
    });

    it('includes $TMPDIR (stripped of trailing slashes) when set', async () => {
      const originalTmpdir = process.env.TMPDIR;
      process.env.TMPDIR = '/var/folders/abc/T//';
      try {
        let capturedOptions: Record<string, unknown> | undefined;
        vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
          const { options } = params as { options: Record<string, unknown> };
          capturedOptions = options;
          return createMockIterator([]) as never;
        });

        const { startSession } = await import('./manager');
        await startSession({
          sessionId: `tmpdir-${Math.random().toString(36).slice(2)}`,
          repoPath: '/some/repo',
          prompt: 'test',
        });
        await new Promise((r) => setTimeout(r, 20));

        expect(capturedOptions?.additionalDirectories).toEqual(
          expect.arrayContaining(['/var/folders/abc/T']),
        );
      } finally {
        if (originalTmpdir === undefined) delete process.env.TMPDIR;
        else process.env.TMPDIR = originalTmpdir;
      }
    });
  });

  describe('canUseTool: allow-return shape (SDK Zod schema)', () => {
    // The @anthropic-ai/claude-agent-sdk Zod schema requires `updatedInput` on
    // every `{ behavior: 'allow' }` response. Missing it throws ZodError and
    // breaks tools like AskUserQuestion. See GH issue #206.

    it('auto-approve (safe-auto) returns updatedInput matching input', async () => {
      const { canUseTool } = await captureCanUseTool('safe-auto');
      const input = { pattern: 'foo', path: '/tmp' };
      const result = await canUseTool('Grep', input, {
        toolUseID: 'safe-shape-1',
        signal: sig(),
      });
      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toEqual(input);
    });

    it('auto-approve (bypass) returns updatedInput matching input', async () => {
      const { canUseTool } = await captureCanUseTool('bypass');
      const input = { file_path: '/tmp/x', content: 'hi' };
      const result = await canUseTool('Write', input, {
        toolUseID: 'bypass-shape-1',
        signal: sig(),
      });
      expect(result.behavior).toBe('allow');
      expect(result.updatedInput).toEqual(input);
    });

    it('user-approved tool (default) returns updatedInput matching input', async () => {
      const input = { question: 'Keep going?' };
      let pendingResult: Awaited<ReturnType<CanUseTool>> | undefined;

      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: { canUseTool: CanUseTool };
        };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            pendingResult = await options.canUseTool('AskUserQuestion', input, {
              toolUseID: 'approval-shape-1',
              signal: new AbortController().signal,
            });
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
          supportedCommands: vi.fn().mockResolvedValue([]),
          supportedModels: vi.fn().mockResolvedValue([]),
        } as never;
      });

      // The poll loop reads resolved approvals from Convex. Match only the
      // approvals query — other queries (e.g. companionGetNextBatchIndex) fall
      // through to the default. Convex FunctionReferences are proxies, so
      // compare by stable name, not reference.
      const approvalsQuery = getFunctionName(
        api.pendingApprovals.companionListResolvedUnconsumed,
      );
      mockQuery.mockImplementation((path: unknown) => {
        if (path && getFunctionName(path as never) === approvalsQuery) {
          return Promise.resolve([
            {
              _id: 'approved-id',
              requestId: 'approval-shape-1',
              approved: true,
            },
          ]);
        }
        return Promise.resolve(null);
      });

      const { startSession } = await import('./manager');
      await startSession({
        sessionId: 'approval-shape-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'default',
      });

      // Wait for the poll interval (500ms) to tick at least once
      await new Promise((r) => setTimeout(r, 800));

      expect(pendingResult?.behavior).toBe('allow');
      expect(pendingResult?.updatedInput).toEqual(input);
    });
  });

  describe('canUseTool: missing toolUseID guard', () => {
    it('immediately denies when toolUseID is empty/undefined', async () => {
      const { canUseTool } = await captureCanUseTool('default');

      // Simulate SDK providing no toolUseID
      const result = await canUseTool(
        'Write',
        {},
        { toolUseID: '' as string, signal: sig() },
      );
      expect(result.behavior).toBe('deny');
      expect(result.message).toMatch(/missing tool use id/i);
    });
  });

  describe('stop session with pending approval', () => {
    it('resolves pending approvals as denied when session is stopped', async () => {
      let pendingResult: { behavior: string; message?: string } | undefined;

      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: { canUseTool: CanUseTool; abortController: AbortController };
        };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            // Use the session's own abort signal — stopSession fires it
            pendingResult = await options.canUseTool(
              'Write',
              {},
              {
                toolUseID: 'pending-1',
                signal: options.abortController.signal,
              },
            );
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
          supportedCommands: vi.fn().mockResolvedValue([]),
          supportedModels: vi.fn().mockResolvedValue([]),
        } as never;
      });

      const { startSession, stopSession } = await import('./manager');
      await startSession({
        sessionId: 'stop-pending-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'default',
      });

      // Wait for the approval to park (create call made, poll loop started)
      await new Promise((r) => setTimeout(r, 100));

      // Abort the session — fires the signal, which resolves the pending approval as denied
      stopSession('stop-pending-test');

      await new Promise((r) => setTimeout(r, 100));
      expect(pendingResult?.behavior).toBe('deny');
      expect(pendingResult?.message).toMatch(/session/i);
    });
  });

  // ---------------------------------------------------------------------------
  // resumed session flush behavior
  // ---------------------------------------------------------------------------

  describe('resumed session flush behavior', () => {
    it('calls flushEvents for every event when resumeProviderSessionId is provided', async () => {
      // getNextBatchIndex returns nextBatchIndex = 5
      mockQuery.mockResolvedValueOnce({ nextBatchIndex: 5 });

      // Three events from the iterator; plus one synthetic prompt event = 4 total
      const mockEvents = [
        { type: 'assistant', text: 'Hello' },
        { type: 'assistant', text: 'World' },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-resume-flush',
        },
      ];
      const mockIter = createMockIterator(mockEvents);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'resume-flush-test',
        repoPath: '/tmp',
        prompt: 'continue the work',
        resumeProviderSessionId: 'sdk-resume-flush',
      });

      // Wait for the iterator to complete and all flushes to settle
      await new Promise((r) => setTimeout(r, 200));

      // companionInsertBatch should have been called multiple times
      const insertCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'batchIndex' in (call[1] as Record<string, unknown>),
      );
      // Prompt event + 3 iterator events = at least 4 insertBatch calls
      expect(insertCalls.length).toBeGreaterThanOrEqual(4);
    });

    it('calls flushEvents for every event even without resumeProviderSessionId', async () => {
      const mockEvents = [
        { type: 'assistant', text: 'Hello' },
        { type: 'assistant', text: 'World' },
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-no-resume',
        },
      ];
      const mockIter = createMockIterator(mockEvents);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'no-resume-flush-test',
        repoPath: '/tmp',
        prompt: 'fresh session',
        // No resumeProviderSessionId — non-resumed session
      });

      // Wait for the iterator to complete
      await new Promise((r) => setTimeout(r, 200));

      // All sessions flush per-event now
      const insertCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'batchIndex' in (call[1] as Record<string, unknown>),
      );
      expect(insertCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessageToSession
  // ---------------------------------------------------------------------------

  describe('sendMessageToSession', () => {
    it('pushes message to channel and buffers it for Convex persistence', async () => {
      const mockIter = createMockIterator([
        {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-msg-test',
          tools: [],
          model: 'claude-sonnet-4-6',
        },
      ]);
      // Make the iterator block so the session stays active
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-msg-test',
            tools: [],
            model: 'claude-sonnet-4-6',
          };
          await blockPromise;
        },
        streamInput: mockIter.streamInput,
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-sonnet-4-6',
            displayName: 'Sonnet 4.6',
            description: 'Balanced',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high'],
          },
        ]),
        applyFlagSettings: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'msg-delivery-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      // Wait for init event to be processed (sets sdkSessionId)
      await new Promise((r) => setTimeout(r, 50));

      const result = await sendMessageToSession(
        'msg-delivery-test',
        'follow-up message',
      );
      expect(result).toBe(true);

      // Wait for the buffered event to be flushed to Convex
      await new Promise((r) => setTimeout(r, 100));

      // The follow-up message should have been flushed via companionInsertBatch
      const insertCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'events' in (call[1] as Record<string, unknown>),
      );
      const allEvents = insertCalls.flatMap((c) =>
        JSON.stringify((c[1] as Record<string, unknown>).events),
      );
      expect(allEvents.join(' ')).toContain('follow-up message');

      // Cleanup
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('returns false when session does not exist', async () => {
      const { sendMessageToSession } = await import('./manager');
      await expect(sendMessageToSession('nonexistent', 'hello')).resolves.toBe(
        false,
      );
    });

    it('returns false when sdkSessionId is not yet set', async () => {
      // Use an iterator that never yields an init event
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const blockingIter = {
        // biome-ignore lint/correctness/useYield: blocking mock — stalls without yielding init
        async *[Symbol.asyncIterator]() {
          await blockPromise;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([]),
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'no-init-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      // sdkSessionId not set yet (no init event)
      await new Promise((r) => setTimeout(r, 20));
      await expect(sendMessageToSession('no-init-test', 'hello')).resolves.toBe(
        false,
      );

      // Cleanup
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('applies xhigh for follow-up messages when the selected model supports it', async () => {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-xhigh-test',
            tools: [],
            model: 'claude-opus-4-6',
          };
          await blockPromise;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            description: 'Most capable',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        ]),
        applyFlagSettings,
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'xhigh-followup-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        model: 'claude-opus-4-6',
      });

      await new Promise((r) => setTimeout(r, 50));
      await expect(
        sendMessageToSession('xhigh-followup-test', 'go deep', 'xhigh'),
      ).resolves.toBe(true);
      await new Promise((r) => setTimeout(r, 50));

      expect(applyFlagSettings).toHaveBeenCalledWith({ effortLevel: 'xhigh' });

      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('does not reset effort when caller omits reasoningEffort on follow-up', async () => {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-omit-effort',
            tools: [],
            model: 'claude-opus-4-6',
          };
          await blockPromise;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            description: 'Most capable',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        ]),
        applyFlagSettings,
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'omit-effort-followup-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        model: 'claude-opus-4-6',
        reasoningEffort: 'high',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Production caller (subscriptions.ts:131) often calls this with no
      // effort. Should keep the session's chosen effort, NOT reset to undefined.
      await expect(
        sendMessageToSession('omit-effort-followup-test', 'follow up'),
      ).resolves.toBe(true);
      await new Promise((r) => setTimeout(r, 50));

      expect(applyFlagSettings).not.toHaveBeenCalled();

      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('passes max on initial query options but treats max follow-ups as auto', async () => {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const applyFlagSettings = vi.fn().mockResolvedValue(undefined);
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-max-test',
            tools: [],
            model: 'claude-opus-4-6',
          };
          await blockPromise;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            description: 'Most capable',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        ]),
        applyFlagSettings,
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'max-followup-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        model: 'claude-opus-4-6',
        reasoningEffort: 'max',
      });

      expect(mockSdkQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({ effort: 'max' }),
        }),
      );

      await new Promise((r) => setTimeout(r, 50));
      await expect(
        sendMessageToSession('max-followup-test', 'again', 'max'),
      ).resolves.toBe(true);
      await new Promise((r) => setTimeout(r, 50));

      expect(applyFlagSettings).toHaveBeenCalledWith({
        effortLevel: undefined,
      });

      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('still pushes the message when applyFlagSettings rejects', async () => {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      const applyFlagSettings = vi
        .fn()
        .mockRejectedValue(new Error('flag settings unavailable'));
      const streamInput = vi.fn().mockResolvedValue(undefined);
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-apply-reject',
            tools: [],
            model: 'claude-opus-4-6',
          };
          await blockPromise;
        },
        streamInput,
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            description: 'Most capable',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        ]),
        applyFlagSettings,
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'apply-reject-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        model: 'claude-opus-4-6',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Effort change requested (auto → high) — applyFlagSettings will reject.
      // The user message must still go through.
      const result = await sendMessageToSession(
        'apply-reject-test',
        'go anyway',
        'high',
      );
      expect(result).toBe(true);
      expect(applyFlagSettings).toHaveBeenCalled();

      await new Promise((r) => setTimeout(r, 50));
      const insertCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'events' in (call[1] as Record<string, unknown>),
      );
      const allEvents = insertCalls
        .map((c) => JSON.stringify((c[1] as Record<string, unknown>).events))
        .join(' ');
      expect(allEvents).toContain('go anyway');

      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('still pushes the message when applyFlagSettings is missing on the iterator', async () => {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });
      // Iterator does NOT expose applyFlagSettings (older SDK build).
      const blockingIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-no-apply',
            tools: [],
            model: 'claude-opus-4-6',
          };
          await blockPromise;
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([
          {
            value: 'claude-opus-4-6',
            displayName: 'Opus 4.6',
            description: 'Most capable',
            supportsEffort: true,
            supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
          },
        ]),
      };
      vi.mocked(mockSdkQuery).mockReturnValue(blockingIter as never);

      const { startSession, sendMessageToSession } = await import('./manager');

      await startSession({
        sessionId: 'no-apply-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        model: 'claude-opus-4-6',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Should not throw — guarded — and should still push.
      const result = await sendMessageToSession(
        'no-apply-test',
        'message body',
        'high',
      );
      expect(result).toBe(true);

      await new Promise((r) => setTimeout(r, 50));
      const insertCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'events' in (call[1] as Record<string, unknown>),
      );
      const allEvents = insertCalls
        .map((c) => JSON.stringify((c[1] as Record<string, unknown>).events))
        .join(' ');
      expect(allEvents).toContain('message body');

      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  // ---------------------------------------------------------------------------
  // session name from prompt
  // ---------------------------------------------------------------------------

  describe('session name from prompt', () => {
    it('persists session name as first 30 chars of prompt to Convex', async () => {
      const mockIter = createMockIterator([]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'name-test',
        repoPath: '/tmp/test',
        prompt:
          'Implement the authentication flow for the login page with OAuth',
      });

      await new Promise((r) => setTimeout(r, 50));

      const nameCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'name' in (call[1] as Record<string, unknown>),
      );
      expect(nameCalls.length).toBeGreaterThan(0);
      expect((nameCalls[0]?.[1] as Record<string, unknown>)?.name).toBe(
        'Implement the authentication f…',
      );
    });

    it('uses full prompt as name when prompt is 30 chars or fewer', async () => {
      const mockIter = createMockIterator([]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'short-name-test',
        repoPath: '/tmp/test',
        prompt: 'Fix the bug',
      });

      await new Promise((r) => setTimeout(r, 50));

      const nameCalls = mockMutation.mock.calls.filter(
        (call) =>
          typeof call[1] === 'object' &&
          'name' in (call[1] as Record<string, unknown>),
      );
      expect(nameCalls.length).toBeGreaterThan(0);
      expect((nameCalls[0]?.[1] as Record<string, unknown>)?.name).toBe(
        'Fix the bug',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // concurrent session limits
  // ---------------------------------------------------------------------------

  describe('concurrent session limits', () => {
    function createBlockingIterator() {
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });

      const iter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: `sdk-blocking-${Math.random().toString(36).slice(2)}`,
            tools: [],
            model: 'claude-sonnet-4-6',
          };
          await blockPromise;
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            result: 'Done',
          };
        },
        streamInput: vi.fn().mockResolvedValue(undefined),
        supportedCommands: vi.fn().mockResolvedValue([]),
        supportedModels: vi.fn().mockResolvedValue([]),
      };

      return { iter, resolveBlock: () => resolveBlock?.(), used: false };
    }

    it('getActiveSessionCount returns number of running sessions', async () => {
      const blocker1 = createBlockingIterator();
      const blocker2 = createBlockingIterator();
      vi.mocked(mockSdkQuery)
        .mockReturnValueOnce(blocker1.iter as never)
        .mockReturnValueOnce(blocker2.iter as never);

      const { startSession, getActiveSessionCount } = await import('./manager');

      await startSession({
        sessionId: 'count-test-1',
        repoPath: '/tmp',
        prompt: 'test 1',
      });
      await startSession({
        sessionId: 'count-test-2',
        repoPath: '/tmp',
        prompt: 'test 2',
      });

      await new Promise((r) => setTimeout(r, 30));
      expect(getActiveSessionCount()).toBe(2);

      blocker1.resolveBlock();
      blocker2.resolveBlock();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('throws when trying to start a session beyond the 10-session limit', async () => {
      const MAX_SESSIONS = 10;
      const blockers = Array.from({ length: MAX_SESSIONS }, () =>
        createBlockingIterator(),
      );

      vi.mocked(mockSdkQuery).mockImplementation(() => {
        const next = blockers.find((b) => !b.used);
        if (next) next.used = true;
        return (next?.iter ?? createMockIterator([])) as never;
      });

      const { startSession } = await import('./manager');

      for (let i = 0; i < MAX_SESSIONS; i++) {
        await startSession({
          sessionId: `limit-test-${i}`,
          repoPath: '/tmp',
          prompt: `test ${i}`,
        });
      }

      await new Promise((r) => setTimeout(r, 30));

      await expect(
        startSession({
          sessionId: 'limit-exceeded',
          repoPath: '/tmp',
          prompt: 'overflow',
        }),
      ).rejects.toThrow(/concurrent session limit/i);

      for (const b of blockers) b.resolveBlock();
      await new Promise((r) => setTimeout(r, 200));
    });

    it('isApproachingSessionLimit returns true at or above 5 active sessions', async () => {
      const WARNING_THRESHOLD = 5;
      const blockers = Array.from({ length: WARNING_THRESHOLD }, () =>
        createBlockingIterator(),
      );
      let blockerIdx = 0;

      vi.mocked(mockSdkQuery).mockImplementation(() => {
        const b = blockers[blockerIdx++];
        return (b?.iter ?? createMockIterator([])) as never;
      });

      const { startSession, isApproachingSessionLimit } = await import(
        './manager'
      );

      expect(isApproachingSessionLimit()).toBe(false);

      for (let i = 0; i < WARNING_THRESHOLD; i++) {
        await startSession({
          sessionId: `warn-test-${i}`,
          repoPath: '/tmp',
          prompt: `test ${i}`,
        });
      }

      await new Promise((r) => setTimeout(r, 30));
      expect(isApproachingSessionLimit()).toBe(true);

      for (const b of blockers) b.resolveBlock();
      await new Promise((r) => setTimeout(r, 200));
    });

    it('startSession returns a warning when 5+ sessions already active', async () => {
      const SESSION_COUNT = 6;
      const blockers = Array.from({ length: SESSION_COUNT }, () =>
        createBlockingIterator(),
      );
      let blockerIdx = 0;

      vi.mocked(mockSdkQuery).mockImplementation(() => {
        const b = blockers[blockerIdx++];
        return (b?.iter ?? createMockIterator([])) as never;
      });

      const { startSession } = await import('./manager');

      for (let i = 0; i < 5; i++) {
        const result = await startSession({
          sessionId: `no-warn-${i}`,
          repoPath: '/tmp',
          prompt: `test ${i}`,
        });
        expect(result.warning).toBeUndefined();
      }

      await new Promise((r) => setTimeout(r, 30));

      const warnResult = await startSession({
        sessionId: 'warn-hit',
        repoPath: '/tmp',
        prompt: 'warning session',
      });
      expect(warnResult.warning).toBeDefined();
      expect(warnResult.warning).toMatch(/\d+ active sessions/i);

      for (const b of blockers) b.resolveBlock();
      await new Promise((r) => setTimeout(r, 200));
    });
  });
});
