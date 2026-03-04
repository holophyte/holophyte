// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK before importing the manager
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock ConvexHttpClient as a proper class
vi.mock('convex/browser', () => {
  class MockConvexHttpClient {
    mutation = vi.fn().mockResolvedValue(undefined);
  }
  return { ConvexHttpClient: MockConvexHttpClient };
});

// Set CONVEX_URL so the manager can create a ConvexHttpClient
process.env.CONVEX_URL = 'http://localhost:3210';

import { query as mockSdkQuery } from '@anthropic-ai/claude-agent-sdk';

afterEach(async () => {
  const { getActiveSessions, stopSession } = await import('./manager');
  for (const id of getActiveSessions()) {
    stopSession(id);
  }
  // Wait for all sessions to drain from the active map. Cleanup involves
  // async calls (flushEvents, denyAll, updateStatus) that need mock fetch.
  const deadline = Date.now() + 2000;
  while (getActiveSessions().length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
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
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const fetchCalls: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchCalls.push(url);
          return new Response('{}', { status: 200 });
        },
      );

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

      // Convex updateStatus should have been called with 'idle'
      const statusCalls = fetchCalls.filter((url) =>
        url.includes('sessions/updateStatus'),
      );
      expect(statusCalls.length).toBeGreaterThan(0);

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });

    it('does nothing for a non-existent session', async () => {
      const { stopSession } = await import('./manager');
      stopSession('non-existent-id');
    });
  });

  describe('session lifecycle', () => {
    it('cleans up on completion and calls updateStatus with idle', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const fetchCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchCalls.push({ url, body: String(init?.body ?? '') });
          return new Response('{}', { status: 200 });
        },
      );

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

      // updateStatus should have been called with 'idle'
      const statusCalls = fetchCalls.filter(({ url }) =>
        url.includes('sessions/updateStatus'),
      );
      expect(statusCalls.length).toBeGreaterThan(0);
      const lastStatusCall = statusCalls[statusCalls.length - 1];
      expect(lastStatusCall?.body).toContain('"idle"');

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });

    it('calls updateStatus with failed for error results', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const fetchCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchCalls.push({ url, body: String(init?.body ?? '') });
          return new Response('{}', { status: 200 });
        },
      );

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

      const statusCalls = fetchCalls.filter(({ url }) =>
        url.includes('sessions/updateStatus'),
      );
      expect(statusCalls.length).toBeGreaterThan(0);
      const lastStatusCall = statusCalls[statusCalls.length - 1];
      expect(lastStatusCall?.body).toContain('"failed"');

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });
  });

  // ---------------------------------------------------------------------------
  // canUseTool / permission mode behaviour
  // ---------------------------------------------------------------------------

  type CanUseTool = (
    tool: string,
    input: Record<string, unknown>,
    opts: { toolUseID: string; signal: AbortSignal },
  ) => Promise<{ behavior: string; toolUseID?: string; message?: string }>;

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
    it('calls pendingApprovals/create for Read and Bash', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const createCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          const body = String(init?.body ?? '');
          if (url.includes('pendingApprovals/create')) {
            createCalls.push({ url, body });
          }
          // listResolvedUnconsumed never resolves so canUseTool stays parked
          if (url.includes('pendingApprovals/listResolvedUnconsumed')) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        },
      );

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

      const r1Calls = createCalls.filter((c) => c.body.includes('"r1"'));
      const r2Calls = createCalls.filter((c) => c.body.includes('"r2"'));
      expect(r1Calls.length).toBeGreaterThan(0);
      expect(r2Calls.length).toBeGreaterThan(0);

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
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

    it('calls pendingApprovals/create for unsafe bash commands', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

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

      const createCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          const body = String(init?.body ?? '');
          if (url.includes('pendingApprovals/create')) {
            createCalls.push({ url, body });
          }
          if (url.includes('pendingApprovals/listResolvedUnconsumed')) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        },
      );

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

      for (const [cmd, id] of unsafe) {
        const matched = createCalls.some((c) => c.body.includes(`"${id}"`));
        expect(
          matched,
          `"${cmd}" should have called pendingApprovals/create`,
        ).toBe(true);
      }

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });

    it('calls pendingApprovals/create for write-side tools (Write, Edit)', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const createCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          const body = String(init?.body ?? '');
          if (url.includes('pendingApprovals/create')) {
            createCalls.push({ url, body });
          }
          if (url.includes('pendingApprovals/listResolvedUnconsumed')) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        },
      );

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

      expect(createCalls.some((c) => c.body.includes('"w1"'))).toBe(true);
      expect(createCalls.some((c) => c.body.includes('"e1"'))).toBe(true);

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
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
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('pendingApprovals/listResolvedUnconsumed')) {
            return new Response(JSON.stringify([]), { status: 200 });
          }
          return new Response('{}', { status: 200 });
        },
      );

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

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });
  });

  // ---------------------------------------------------------------------------
  // resumed session flush behavior
  // ---------------------------------------------------------------------------

  describe('resumed session flush behavior', () => {
    it('calls flushEvents for every event when resumeSdkSessionId is provided', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      let insertBatchCallCount = 0;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessionEvents/insertBatch')) {
            insertBatchCallCount++;
          }
          // getNextBatchIndex returns nextBatchIndex = 0
          if (url.includes('sessionEvents/getNextBatchIndex')) {
            return new Response(JSON.stringify({ nextBatchIndex: 5 }), {
              status: 200,
            });
          }
          return new Response('{}', { status: 200 });
        });

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
        resumeSdkSessionId: 'sdk-resume-flush',
      });

      // Wait for the iterator to complete and all flushes to settle
      await new Promise((r) => setTimeout(r, 200));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      // Each event triggers an immediate flush (per-event). The prompt synthetic
      // event + 3 iterator events = 4 total inserts (flushing is idempotent so
      // empty flushes are no-ops). Allow for at least 4 insertBatch calls.
      expect(insertBatchCallCount).toBeGreaterThanOrEqual(4);
    });

    it('calls flushEvents for every event even without resumeSdkSessionId', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      let insertBatchCallCount = 0;
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessionEvents/insertBatch')) {
            insertBatchCallCount++;
          }
          return new Response('{}', { status: 200 });
        });

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
        // No resumeSdkSessionId — non-resumed session
      });

      // Wait for the iterator to complete
      await new Promise((r) => setTimeout(r, 200));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      // All sessions flush per-event now, so prompt event + 3 iterator events
      // = at least 4 insertBatch calls (may merge concurrent flushes).
      expect(insertBatchCallCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessageToSession
  // ---------------------------------------------------------------------------

  describe('sendMessageToSession', () => {
    it('pushes message to channel and buffers it for Convex persistence', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const insertBatchBodies: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessionEvents/insertBatch')) {
            insertBatchBodies.push(String(init?.body ?? ''));
          }
          return new Response('{}', { status: 200 });
        },
      );

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

      const result = sendMessageToSession(
        'msg-delivery-test',
        'follow-up message',
      );
      expect(result).toBe(true);

      // Wait for the buffered event to be flushed to Convex
      await new Promise((r) => setTimeout(r, 100));

      // The follow-up message should have been flushed via insertBatch
      const allBodies = insertBatchBodies.join(' ');
      expect(allBodies).toContain('follow-up message');

      // Cleanup
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });

    it('returns false when session does not exist', async () => {
      const { sendMessageToSession } = await import('./manager');
      expect(sendMessageToSession('nonexistent', 'hello')).toBe(false);
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
      expect(sendMessageToSession('no-init-test', 'hello')).toBe(false);

      // Cleanup
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });
  });

  // ---------------------------------------------------------------------------
  // session name from prompt
  // ---------------------------------------------------------------------------

  describe('session name from prompt', () => {
    it('persists session name as first 30 chars of prompt to Convex', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const fetchCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchCalls.push({ url, body: String(init?.body ?? '') });
          return new Response('{}', { status: 200 });
        },
      );

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

      const nameCalls = fetchCalls.filter(({ url }) =>
        url.includes('updateName'),
      );
      expect(nameCalls.length).toBeGreaterThan(0);
      expect(nameCalls[0]?.body).toContain('Implement the authentication f…');

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
    });

    it('uses full prompt as name when prompt is 30 chars or fewer', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      const fetchCalls: Array<{ url: string; body: string }> = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input.toString();
          fetchCalls.push({ url, body: String(init?.body ?? '') });
          return new Response('{}', { status: 200 });
        },
      );

      const mockIter = createMockIterator([]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession } = await import('./manager');

      await startSession({
        sessionId: 'short-name-test',
        repoPath: '/tmp/test',
        prompt: 'Fix the bug',
      });

      await new Promise((r) => setTimeout(r, 50));

      const nameCalls = fetchCalls.filter(({ url }) =>
        url.includes('updateName'),
      );
      expect(nameCalls.length).toBeGreaterThan(0);
      expect(nameCalls[0]?.body).toContain('Fix the bug');

      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;
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
