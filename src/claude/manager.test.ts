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
  // Allow background async cleanup (consumeIterator finally block) to complete
  await new Promise((r) => setTimeout(r, 100));
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

      const { startSession, stopSession, getSession, subscribe } = await import(
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

      // Subscribe after the session exists so we capture subsequent broadcasts
      const capturedMessages: Array<Record<string, unknown>> = [];
      const unsubscribe = subscribe('stop-test', (msg) => {
        capturedMessages.push(msg as Record<string, unknown>);
      });

      stopSession('stop-test');

      // Simulate SDK throwing AbortError when the controller is aborted
      abortReject?.(new Error('AbortError'));
      await new Promise((r) => setTimeout(r, 50));
      unsubscribe();

      const statusMsgs = capturedMessages.filter((m) => m.type === 'status');
      const finalStatus = statusMsgs[statusMsgs.length - 1];
      // In the session-rethink model, stopped sessions become idle (still resumable)
      expect(finalStatus?.status).toBe('idle');
    });

    it('does nothing for a non-existent session', async () => {
      const { stopSession } = await import('./manager');
      stopSession('non-existent-id');
    });
  });

  describe('subscribe', () => {
    it('adds and removes subscribers', async () => {
      const mockIter = createMockIterator([]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, subscribe } = await import('./manager');

      await startSession({
        sessionId: 'sub-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      const callback = vi.fn();
      const unsubscribe = subscribe('sub-test', callback);
      expect(typeof unsubscribe).toBe('function');

      unsubscribe();

      await new Promise((r) => setTimeout(r, 50));
    });

    it('returns a no-op unsubscribe for non-existent session', async () => {
      const { subscribe } = await import('./manager');
      const unsubscribe = subscribe('non-existent', vi.fn());
      expect(typeof unsubscribe).toBe('function');
      unsubscribe();
    });
  });

  describe('respondToApproval', () => {
    it('resolves a pending approval with allow', async () => {
      let canUseToolCalled = false;
      let canUseToolResult: unknown;

      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as {
          options: {
            canUseTool: (
              tool: string,
              input: Record<string, unknown>,
              opts: { toolUseID: string; signal: AbortSignal },
            ) => Promise<unknown>;
          };
        };

        return {
          async *[Symbol.asyncIterator]() {
            canUseToolCalled = true;
            // Call canUseTool — this parks in the approval queue
            canUseToolResult = await options.canUseTool(
              'Write',
              { path: '/tmp/file.txt' },
              {
                toolUseID: 'tool-1',
                signal: new AbortController().signal,
              },
            );
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Done',
              session_id: 'sdk-approval',
            };
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
        } as never;
      });

      const { startSession, respondToApproval } = await import('./manager');

      await startSession({
        sessionId: 'approval-test',
        repoPath: '/tmp/test',
        prompt: 'test',
        permissionMode: 'default',
      });

      // Wait for canUseTool to fire (it runs in background microtask)
      await new Promise((r) => setTimeout(r, 50));
      expect(canUseToolCalled).toBe(true);

      // Resolve the pending approval
      const resolved = respondToApproval('approval-test', 'tool-1', true);
      expect(resolved).toBe(true);

      // Wait for the iterator to finish processing
      await new Promise((r) => setTimeout(r, 50));
      expect(canUseToolResult).toEqual({
        behavior: 'allow',
        toolUseID: 'tool-1',
      });
    });

    it('returns false for non-existent session', async () => {
      const { respondToApproval } = await import('./manager');
      expect(respondToApproval('nope', 'req-1', true)).toBe(false);
    });

    it('returns false for non-existent request', async () => {
      const mockIter = createMockIterator([]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, respondToApproval } = await import('./manager');

      await startSession({
        sessionId: 'no-req-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      expect(respondToApproval('no-req-test', 'nonexistent', true)).toBe(false);

      await new Promise((r) => setTimeout(r, 50));
    });
  });

  describe('session lifecycle', () => {
    it('broadcasts status changes and cleans up on completion', async () => {
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

      const { startSession, subscribe, getSession } = await import('./manager');

      const messages: Array<{ type: string; status?: string }> = [];

      await startSession({
        sessionId: 'lifecycle-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      subscribe('lifecycle-test', (msg) => {
        messages.push(msg);
      });

      // Let iterator complete — no idle timeout in new model, session cleans up after turn
      await new Promise((r) => setTimeout(r, 100));

      // Session should be cleaned up (goes idle in Convex, removed from active map)
      expect(getSession('lifecycle-test')).toBeUndefined();

      // Should have received a final status message (idle, not completed)
      const statusMsgs = messages.filter((m) => m.type === 'status');
      expect(statusMsgs.length).toBeGreaterThan(0);
      const finalStatus = statusMsgs[statusMsgs.length - 1];
      expect(finalStatus?.status).toBe('idle');
    });

    it('reports failed status for error results', async () => {
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

      const { startSession, subscribe } = await import('./manager');

      const messages: Array<{ type: string; status?: string }> = [];

      await startSession({
        sessionId: 'error-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      subscribe('error-test', (msg) => {
        messages.push(msg);
      });

      // Let iterator complete
      await new Promise((r) => setTimeout(r, 100));

      const finalStatus = messages.filter((m) => m.type === 'status').pop();
      expect(finalStatus?.status).toBe('failed');
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
    it('parks Read and Bash in the approval queue', async () => {
      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as { options: { canUseTool: CanUseTool } };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            // Fire concurrently so both park before the generator suspends
            await Promise.all([
              options.canUseTool(
                'Read',
                {},
                { toolUseID: 'r1', signal: sig() },
              ),
              options.canUseTool(
                'Bash',
                { command: 'ls' },
                { toolUseID: 'r2', signal: sig() },
              ),
            ]);
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
        } as never;
      });

      const { startSession, getSession } = await import('./manager');
      await startSession({
        sessionId: 'default-queue-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'default',
      });

      await new Promise((r) => setTimeout(r, 50));
      const session = getSession('default-queue-test');
      expect(session?.approvalQueue.has('r1')).toBe(true);
      expect(session?.approvalQueue.has('r2')).toBe(true);
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

    it('queues unsafe bash commands (write ops, dangerous flags, shell operators)', async () => {
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
        const { options } = params as { options: { canUseTool: CanUseTool } };
        return {
          async *[Symbol.asyncIterator]() {
            await Promise.all(
              unsafe.map(([cmd, id]) =>
                options.canUseTool(
                  'Bash',
                  { command: cmd },
                  { toolUseID: id, signal: sig() },
                ),
              ),
            );
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
        } as never;
      });

      const { startSession, getSession } = await import('./manager');
      await startSession({
        sessionId: 'unsafe-bash-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'safe-auto',
      });

      await new Promise((r) => setTimeout(r, 50));
      const session = getSession('unsafe-bash-test');
      for (const [cmd, id] of unsafe) {
        expect(
          session?.approvalQueue.has(id),
          `"${cmd}" should be queued`,
        ).toBe(true);
      }
    });

    it('queues write-side tools (Write, Edit)', async () => {
      vi.mocked(mockSdkQuery).mockImplementation((params: unknown) => {
        const { options } = params as { options: { canUseTool: CanUseTool } };
        return {
          // biome-ignore lint/correctness/useYield: blocking mock — parks via await without yielding events
          async *[Symbol.asyncIterator]() {
            await Promise.all([
              options.canUseTool(
                'Write',
                { file_path: '/tmp/x' },
                { toolUseID: 'w1', signal: sig() },
              ),
              options.canUseTool(
                'Edit',
                { file_path: '/tmp/x' },
                { toolUseID: 'e1', signal: sig() },
              ),
            ]);
          },
          streamInput: vi.fn().mockResolvedValue(undefined),
        } as never;
      });

      const { startSession, getSession } = await import('./manager');
      await startSession({
        sessionId: 'write-tools-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'safe-auto',
      });

      await new Promise((r) => setTimeout(r, 50));
      const session = getSession('write-tools-test');
      expect(session?.approvalQueue.has('w1')).toBe(true);
      expect(session?.approvalQueue.has('e1')).toBe(true);
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
        } as never;
      });

      const { startSession, stopSession } = await import('./manager');
      await startSession({
        sessionId: 'stop-pending-test',
        repoPath: '/tmp',
        prompt: 'test',
        permissionMode: 'default',
      });

      // Wait for the approval to park
      await new Promise((r) => setTimeout(r, 50));

      // Abort the session — fires the signal, which resolves the pending approval as denied
      stopSession('stop-pending-test');

      await new Promise((r) => setTimeout(r, 100));
      expect(pendingResult?.behavior).toBe('deny');
      expect(pendingResult?.message).toMatch(/session/i);
    });
  });

  // ---------------------------------------------------------------------------
  // warnPersistence / persistenceWarned
  // ---------------------------------------------------------------------------

  describe('warnPersistence (via flushEvents failure)', () => {
    it('broadcasts a warning message when flushEvents fails', async () => {
      // Set env vars so getConvexConfig() returns config (not null),
      // allowing fetch to be called and our mock to intercept it.
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      // Make callConvexInternal throw for the event flush but succeed for
      // other internal calls (updateName, updateStatus) by targeting the path.
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessionEvents/insertBatch')) {
            throw new Error('Network error');
          }
          // Other internal calls succeed
          return new Response('{}', { status: 200 });
        });

      // Provide a mock iterator that yields one event so the buffer is non-empty
      // when flushEvents is called in the finally block.
      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-flush-warn',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, subscribe } = await import('./manager');

      const warnings: Array<{ type: string; message: string }> = [];

      await startSession({
        sessionId: 'warn-flush-test',
        repoPath: '/tmp',
        prompt: 'test',
      });

      // Subscribe immediately — session is in memory, consumeIterator is still running
      subscribe('warn-flush-test', (msg) => {
        if (msg.type === 'warning') {
          warnings.push({ type: msg.type, message: msg.message });
        }
      });

      // Wait for consumeIterator to complete and the final flushEvents to fire
      await new Promise((r) => setTimeout(r, 200));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      expect(warnings).toHaveLength(1);
      expect(warnings[0]?.message).toMatch(/persist/i);
    });

    it('sends the warning only once per session even if multiple flushes fail', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      // Fail every insertBatch call
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessionEvents/insertBatch')) {
            throw new Error('Network error');
          }
          return new Response('{}', { status: 200 });
        });

      // Use a large enough event stream to trigger multiple buffer flushes.
      // We do this by providing many events so the buffer fills up.
      const manyEvents = Array.from({ length: 5 }, (_, i) => ({
        type: 'text',
        text: `Message ${i}`,
      }));

      const mockIter = createMockIterator(manyEvents);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, subscribe } = await import('./manager');

      const warnings: string[] = [];

      await startSession({
        sessionId: 'warn-once-test',
        repoPath: '/tmp',
        prompt: 'test',
      });

      subscribe('warn-once-test', (msg) => {
        if (msg.type === 'warning') warnings.push(msg.message);
      });

      await new Promise((r) => setTimeout(r, 150));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      // Regardless of how many flushes failed, only one warning should be sent
      expect(warnings).toHaveLength(1);
    });

    it('broadcasts warning when updateStatus Convex call fails', async () => {
      process.env.CONVEX_SITE_URL = 'http://localhost:3211';
      process.env.INTERNAL_API_SECRET = 'test-secret';

      // Fail only the updateStatus call so we test that specific code path
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('sessions/updateStatus')) {
            throw new Error('Status update failed');
          }
          // insertBatch and updateName succeed — no prior warning should have fired
          return new Response('{}', { status: 200 });
        });

      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-status-warn',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, subscribe } = await import('./manager');

      const warnings: string[] = [];

      await startSession({
        sessionId: 'warn-status-test',
        repoPath: '/tmp',
        prompt: 'test',
      });

      subscribe('warn-status-test', (msg) => {
        if (msg.type === 'warning') warnings.push(msg.message);
      });

      await new Promise((r) => setTimeout(r, 150));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/persist/i);
    });

    it('broadcasts warning when config is missing (callConvexInternal returns false)', async () => {
      // Do NOT set CONVEX_SITE_URL / INTERNAL_API_SECRET — getConvexConfig returns null,
      // callConvexInternal returns false, and the `!persisted` branch should trigger.
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      const mockIter = createMockIterator([
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: 'Done',
          session_id: 'sdk-no-config',
        },
      ]);
      vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

      const { startSession, subscribe } = await import('./manager');

      const warnings: string[] = [];

      await startSession({
        sessionId: 'warn-no-config-test',
        repoPath: '/tmp',
        prompt: 'test',
      });

      subscribe('warn-no-config-test', (msg) => {
        if (msg.type === 'warning') warnings.push(msg.message);
      });

      await new Promise((r) => setTimeout(r, 200));

      // Warning should fire via the !persisted check (not the catch block)
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/persist/i);
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

    it('does NOT flush per-event for non-resumed sessions (uses 5s timer)', async () => {
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

      // Wait for the iterator to complete (but NOT the 5s flush timer)
      await new Promise((r) => setTimeout(r, 150));

      fetchSpy.mockRestore();
      delete process.env.CONVEX_SITE_URL;
      delete process.env.INTERNAL_API_SECRET;

      // Non-resumed sessions only flush in the finally block (once) — not per-event.
      // The MAX_BUFFER_SIZE (200) is not reached by 4 events, so only 1 flush occurs.
      expect(insertBatchCallCount).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // sendMessageToSession
  // ---------------------------------------------------------------------------

  describe('sendMessageToSession', () => {
    it('pushes message to channel and broadcasts to subscribers', async () => {
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

      const { startSession, subscribe, sendMessageToSession } = await import(
        './manager'
      );

      await startSession({
        sessionId: 'msg-delivery-test',
        repoPath: '/tmp/test',
        prompt: 'test',
      });

      // Wait for init event to be processed (sets sdkSessionId)
      await new Promise((r) => setTimeout(r, 50));

      const capturedEvents: Array<Record<string, unknown>> = [];
      subscribe('msg-delivery-test', (msg) => {
        capturedEvents.push(msg as Record<string, unknown>);
      });

      const result = sendMessageToSession(
        'msg-delivery-test',
        'follow-up message',
      );
      expect(result).toBe(true);

      // Should have broadcast the follow-up user message (subscribe also
      // replays the initial prompt from the event buffer, so filter by content)
      const userEvents = capturedEvents.filter(
        (e) =>
          e.type === 'event' &&
          (e.event as Record<string, unknown>).type === 'user',
      );
      const followUp = userEvents.find((e) => {
        const msg = (e as { event: { message: { content: string } } }).event
          .message;
        return msg.content === 'follow-up message';
      });
      expect(followUp).toBeDefined();
      const event = (followUp as { event: Record<string, unknown> }).event;
      expect(event.type).toBe('user');
      expect((event.message as { content: string }).content).toBe(
        'follow-up message',
      );
      expect(event.session_id).toBe('sdk-msg-test');
      expect(event.uuid).toBeDefined();

      // Cleanup
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
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
});
