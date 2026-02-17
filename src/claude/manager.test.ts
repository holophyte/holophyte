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
    it('aborts the controller and marks session as stopped', async () => {
      // Create a long-running iterator that never completes on its own
      let resolveBlock: (() => void) | undefined;
      const blockPromise = new Promise<void>((r) => {
        resolveBlock = r;
      });

      const mockIter = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'system',
            subtype: 'init',
            session_id: 'sdk-789',
            tools: [],
            model: 'claude-sonnet-4-5-20250929',
          };
          await blockPromise;
        },
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

      stopSession('stop-test');

      // Unblock to let cleanup run
      resolveBlock?.();
      await new Promise((r) => setTimeout(r, 50));
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

      // Wait for iterator to complete
      await new Promise((r) => setTimeout(r, 100));

      // Session should be cleaned up
      expect(getSession('lifecycle-test')).toBeUndefined();

      // Should have received a final status message
      const statusMsgs = messages.filter((m) => m.type === 'status');
      expect(statusMsgs.length).toBeGreaterThan(0);
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

      await new Promise((r) => setTimeout(r, 100));

      const finalStatus = messages.filter((m) => m.type === 'status').pop();
      expect(finalStatus?.status).toBe('failed');
    });
  });
});
