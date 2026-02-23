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

  describe('sendSessionMessage', () => {
    it('returns false — single-turn mode (resume via new session with sdkSessionId)', async () => {
      // In the session-rethink model, sessions are single-turn.
      // sendSessionMessage is a no-op; follow-ups use startSession with resumeSdkSessionId.
      let resolveBlock: (() => void) | undefined;

      vi.mocked(mockSdkQuery).mockImplementation(() => {
        return {
          async *[Symbol.asyncIterator]() {
            yield {
              type: 'system',
              subtype: 'init',
              session_id: 'sdk-queue',
              tools: [],
              model: 'claude-sonnet-4-5-20250929',
            };
            await new Promise<void>((r) => {
              resolveBlock = r;
            });
            yield {
              type: 'result',
              subtype: 'success',
              is_error: false,
              result: 'Done',
              session_id: 'sdk-queue',
            };
          },
        } as never;
      });

      const { startSession, sendSessionMessage } = await import('./manager');

      await startSession({
        sessionId: 'queue-msg-test',
        repoPath: '/tmp',
        prompt: 'initial',
      });

      // Wait for the session to be running
      await new Promise((r) => setTimeout(r, 30));

      // sendSessionMessage is a no-op in single-turn mode
      const sent = sendSessionMessage('queue-msg-test', 'follow-up text');
      expect(sent).toBe(false);

      // Unblock and let session clean up
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 100));
    });

    it('returns false when session does not exist', async () => {
      const { sendSessionMessage } = await import('./manager');
      expect(sendSessionMessage('nonexistent', 'hello')).toBe(false);
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
});
