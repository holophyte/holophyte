// @vitest-environment node
/**
 * Tests for the session-rethink manager changes:
 * - No idle timeout: sessions become 'idle' in Convex after each turn
 * - Only three statuses: 'running' | 'idle' | 'failed'
 * - Concurrent session limit: max 10 active sessions globally
 * - Warning threshold at 5 active sessions
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

// Mock fetch for Convex internal calls
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  text: async () => '',
} as Response) as unknown as typeof fetch;

process.env.CONVEX_SITE_URL = 'http://localhost:3211';
process.env.INTERNAL_API_SECRET = 'test-secret';

import { query as mockSdkQuery } from '@anthropic-ai/claude-agent-sdk';

afterEach(async () => {
  const { getActiveSessions, stopSession } = await import('./manager');
  for (const id of getActiveSessions()) {
    stopSession(id);
  }
  // Longer wait to allow blocking iterators from limit tests to finish cleanup
  await new Promise((r) => setTimeout(r, 300));
  vi.restoreAllMocks();
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    text: async () => '',
  } as Response);
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

/** Helper: create a blocking iterator that stalls until resolved. */
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
  };

  return { iter, resolveBlock: () => resolveBlock?.(), used: false };
}

describe('session-rethink: idle status replaces completed/stopped', () => {
  it('Convex is updated with idle when turn completes normally', async () => {
    const mockIter = createMockIterator([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done',
      },
    ]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const capturedFetchCalls: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const path = String(url).replace('http://localhost:3211', '');
      const body = JSON.parse((opts?.body as string) ?? '{}') as Record<
        string,
        unknown
      >;
      capturedFetchCalls.push({ path, body });
      return { ok: true, text: async () => '' } as Response;
    });

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'idle-status-test',
      repoPath: '/tmp/test',
      prompt: 'test',
    });

    // Let the iterator complete
    await new Promise((r) => setTimeout(r, 100));

    // Should update Convex with 'idle', not 'completed' or 'stopped'
    const statusUpdates = capturedFetchCalls.filter((c) =>
      c.path.includes('updateStatus'),
    );
    expect(statusUpdates.length).toBeGreaterThan(0);
    const finalStatus = statusUpdates[statusUpdates.length - 1];
    expect(finalStatus?.body.status).toBe('idle');
    expect(statusUpdates.some((c) => c.body.status === 'completed')).toBe(
      false,
    );
    expect(statusUpdates.some((c) => c.body.status === 'stopped')).toBe(false);
  });

  it('stop session sends idle status to Convex (not stopped)', async () => {
    let abortReject: ((err: Error) => void) | undefined;

    const mockIter = {
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'system',
          subtype: 'init',
          session_id: 'sdk-stop-idle',
          tools: [],
          model: 'claude-sonnet-4-6',
        };
        await new Promise<never>((_, reject) => {
          abortReject = reject;
        });
      },
    };
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const capturedFetchCalls: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const path = String(url).replace('http://localhost:3211', '');
      const body = JSON.parse((opts?.body as string) ?? '{}') as Record<
        string,
        unknown
      >;
      capturedFetchCalls.push({ path, body });
      return { ok: true, text: async () => '' } as Response;
    });

    const { startSession, stopSession } = await import('./manager');

    await startSession({
      sessionId: 'stop-idle-test',
      repoPath: '/tmp/test',
      prompt: 'test',
    });

    await new Promise((r) => setTimeout(r, 30));

    stopSession('stop-idle-test');
    abortReject?.(new Error('AbortError'));

    await new Promise((r) => setTimeout(r, 100));

    // Should send 'idle' to Convex, not 'stopped'
    const statusUpdates = capturedFetchCalls.filter((c) =>
      c.path.includes('updateStatus'),
    );
    expect(statusUpdates.length).toBeGreaterThan(0);
    const finalUpdate = statusUpdates[statusUpdates.length - 1];
    expect(finalUpdate?.body.status).toBe('idle');
    expect(statusUpdates.some((c) => c.body.status === 'stopped')).toBe(false);
  });

  it('failed session sends failed status to Convex', async () => {
    const mockIter = createMockIterator([
      {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        errors: ['Something went wrong'],
        session_id: 'sdk-fail',
      },
    ]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const capturedFetchCalls: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const path = String(url).replace('http://localhost:3211', '');
      const body = JSON.parse((opts?.body as string) ?? '{}') as Record<
        string,
        unknown
      >;
      capturedFetchCalls.push({ path, body });
      return { ok: true, text: async () => '' } as Response;
    });

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'fail-status-test',
      repoPath: '/tmp/test',
      prompt: 'test',
    });

    await new Promise((r) => setTimeout(r, 100));

    const statusUpdates = capturedFetchCalls.filter((c) =>
      c.path.includes('updateStatus'),
    );
    expect(statusUpdates.length).toBeGreaterThan(0);
    const finalStatus = statusUpdates[statusUpdates.length - 1];
    expect(finalStatus?.body.status).toBe('failed');
  });

  it('WS status broadcast uses idle (not completed) after turn finishes', async () => {
    const mockIter = createMockIterator([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done',
      },
    ]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const { startSession, subscribe } = await import('./manager');
    const messages: Array<{ type: string; status?: string }> = [];

    await startSession({
      sessionId: 'ws-idle-test',
      repoPath: '/tmp/test',
      prompt: 'test',
    });

    subscribe('ws-idle-test', (msg) => {
      messages.push(msg as { type: string; status?: string });
    });

    await new Promise((r) => setTimeout(r, 100));

    const statusMsgs = messages.filter((m) => m.type === 'status');
    const finalStatus = statusMsgs[statusMsgs.length - 1];
    expect(finalStatus?.status).toBe('idle');
    expect(statusMsgs.some((m) => m.status === 'completed')).toBe(false);
    expect(statusMsgs.some((m) => m.status === 'stopped')).toBe(false);
  });
});

describe('session-rethink: session name from prompt', () => {
  it('persists session name as first 30 chars of prompt to Convex', async () => {
    const mockIter = createMockIterator([]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const capturedFetchCalls: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const path = String(url).replace('http://localhost:3211', '');
      const body = JSON.parse((opts?.body as string) ?? '{}') as Record<
        string,
        unknown
      >;
      capturedFetchCalls.push({ path, body });
      return { ok: true, text: async () => '' } as Response;
    });

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'name-test',
      repoPath: '/tmp/test',
      prompt: 'Implement the authentication flow for the login page with OAuth',
    });

    await new Promise((r) => setTimeout(r, 50));

    const nameCalls = capturedFetchCalls.filter((c) =>
      c.path.includes('updateName'),
    );
    expect(nameCalls.length).toBeGreaterThan(0);
    const nameCall = nameCalls[0];
    expect(nameCall?.body.name).toBe('Implement the authentication f…');
  });

  it('uses full prompt as name when prompt is 30 chars or fewer', async () => {
    const mockIter = createMockIterator([]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const capturedFetchCalls: Array<{
      path: string;
      body: Record<string, unknown>;
    }> = [];
    vi.mocked(global.fetch).mockImplementation(async (url, opts) => {
      const path = String(url).replace('http://localhost:3211', '');
      const body = JSON.parse((opts?.body as string) ?? '{}') as Record<
        string,
        unknown
      >;
      capturedFetchCalls.push({ path, body });
      return { ok: true, text: async () => '' } as Response;
    });

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'short-name-test',
      repoPath: '/tmp/test',
      prompt: 'Fix the bug',
    });

    await new Promise((r) => setTimeout(r, 50));

    const nameCalls = capturedFetchCalls.filter((c) =>
      c.path.includes('updateName'),
    );
    expect(nameCalls.length).toBeGreaterThan(0);
    expect(nameCalls[0]?.body.name).toBe('Fix the bug');
  });
});

describe('session-rethink: concurrent session limits', () => {
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

    // Resolve iterators so sessions clean up before afterEach
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

    // Start MAX_SESSIONS sessions
    for (let i = 0; i < MAX_SESSIONS; i++) {
      await startSession({
        sessionId: `limit-test-${i}`,
        repoPath: '/tmp',
        prompt: `test ${i}`,
      });
    }

    await new Promise((r) => setTimeout(r, 30));

    // The 11th session should be rejected
    await expect(
      startSession({
        sessionId: 'limit-exceeded',
        repoPath: '/tmp',
        prompt: 'overflow',
      }),
    ).rejects.toThrow(/concurrent session limit/i);

    // Resolve all blocking iterators so sessions clean up
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

    // Below threshold
    expect(isApproachingSessionLimit()).toBe(false);

    for (let i = 0; i < WARNING_THRESHOLD; i++) {
      await startSession({
        sessionId: `warn-test-${i}`,
        repoPath: '/tmp',
        prompt: `test ${i}`,
      });
    }

    await new Promise((r) => setTimeout(r, 30));

    // At threshold
    expect(isApproachingSessionLimit()).toBe(true);

    // Resolve all so sessions clean up
    for (const b of blockers) b.resolveBlock();
    await new Promise((r) => setTimeout(r, 200));
  });

  it('startSession returns a warning when 5+ sessions already active', async () => {
    // Warning fires when activeCount >= WARN_ACTIVE_SESSIONS (5) at the moment of starting.
    // So we need 5 sessions already running, then start the 6th to get a warning.
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

    // First 5 sessions: 0..4 active when starting each — no warning
    for (let i = 0; i < 5; i++) {
      const result = await startSession({
        sessionId: `no-warn-${i}`,
        repoPath: '/tmp',
        prompt: `test ${i}`,
      });
      expect(result.warning).toBeUndefined();
    }

    await new Promise((r) => setTimeout(r, 30));

    // 6th session: 5 already active → warning fires
    const warnResult = await startSession({
      sessionId: 'warn-hit',
      repoPath: '/tmp',
      prompt: 'warning session',
    });
    expect(warnResult.warning).toBeDefined();
    expect(warnResult.warning).toMatch(/\d+ active sessions/i);

    // Resolve all so sessions clean up
    for (const b of blockers) b.resolveBlock();
    await new Promise((r) => setTimeout(r, 200));
  });
});

describe('session-rethink: single-turn mode (no follow-up loop)', () => {
  it('session is removed from active map after turn completes', async () => {
    const mockIter = createMockIterator([
      {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'Done',
      },
    ]);
    vi.mocked(mockSdkQuery).mockReturnValue(mockIter as never);

    const { startSession, getSession } = await import('./manager');

    await startSession({
      sessionId: 'cleanup-test',
      repoPath: '/tmp/test',
      prompt: 'test',
    });

    // Wait for turn to complete
    await new Promise((r) => setTimeout(r, 100));

    // Session should be removed from active map (it's now idle in Convex)
    expect(getSession('cleanup-test')).toBeUndefined();
  });
});
