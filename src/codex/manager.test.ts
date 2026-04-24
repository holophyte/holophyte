// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const mockCreateClient = vi.fn();

vi.mock('codex-app-server-client', () => ({
  createClient: mockCreateClient,
}));

const mockMutation = vi.fn().mockResolvedValue(undefined);
const mockQuery = vi.fn().mockResolvedValue({ nextBatchIndex: 0 });

vi.mock('@/server/convex-client', () => ({
  getConvexClient: vi.fn(() => ({ mutation: mockMutation })),
  getConvexHttpClient: vi.fn(async () => ({ query: mockQuery })),
}));

interface Notification {
  method: string;
  params: {
    threadId?: string;
    turn?: {
      id: string;
      status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
      items: unknown[];
      error: null;
      startedAt: number | null;
      completedAt: number | null;
      durationMs: number | null;
    };
  };
}

type TurnStatus = NonNullable<Notification['params']['turn']>['status'];

function makeTurn(id: string, status: TurnStatus) {
  return {
    id,
    status,
    items: [],
    error: null,
    startedAt: Date.now() / 1000,
    completedAt: Date.now() / 1000,
    durationMs: 1,
  };
}

function makeClientStub() {
  const handlers = new Map<
    string,
    Array<(notification: Notification) => void>
  >();
  const emit = (notification: Notification) => {
    for (const handler of handlers.get(notification.method) ?? []) {
      handler(notification);
    }
  };

  return {
    thread: {
      start: vi.fn().mockResolvedValue({
        thread: { id: 'thread-123' },
        model: 'gpt-5.4-mini',
        modelProvider: 'openai',
        serviceTier: null,
        cwd: '/tmp/repo',
        approvalPolicy: 'never',
        approvalsReviewer: 'client',
        sandbox: { type: 'danger-full-access' },
        reasoningEffort: 'medium',
      }),
      resume: vi.fn(),
    },
    turn: {
      start: vi.fn(async () => {
        emit({
          method: 'turn/started',
          params: {
            threadId: 'thread-123',
            turn: makeTurn('turn-123', 'inProgress'),
          },
        });
        emit({
          method: 'turn/completed',
          params: {
            threadId: 'thread-123',
            turn: makeTurn('turn-123', 'completed'),
          },
        });
        return { turn: makeTurn('turn-123', 'completed') };
      }),
      interrupt: vi.fn().mockResolvedValue({}),
    },
    onEvent: vi.fn(
      (method: string, handler: (notification: Notification) => void) => {
        const existing = handlers.get(method) ?? [];
        existing.push(handler);
        handlers.set(method, existing);
        return () => {
          handlers.set(
            method,
            (handlers.get(method) ?? []).filter((h) => h !== handler),
          );
        };
      },
    ),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

afterEach(async () => {
  const { getActiveSessions, stopSession } = await import('./manager');
  for (const id of getActiveSessions()) {
    stopSession(id);
  }
  await new Promise((resolve) => setTimeout(resolve, 650));
  mockCreateClient.mockReset();
  mockMutation.mockClear();
  mockQuery.mockClear();
});

describe('codex/manager', () => {
  it('starts a bypass turn, persists providerSessionId, and flushes completion events', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-session-id',
      repoPath: '/tmp/repo',
      prompt: 'say hello',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    await new Promise((resolve) => setTimeout(resolve, 650));

    expect(mockCreateClient).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
    expect(client.thread.start).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: '/tmp/repo',
        approvalPolicy: 'never',
      }),
    );
    expect(client.turn.start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-123',
        approvalPolicy: 'never',
        effort: 'medium',
      }),
    );

    const providerCall = mockMutation.mock.calls.find(
      (call) =>
        typeof call[1] === 'object' &&
        (call[1] as Record<string, unknown>).providerSessionId === 'thread-123',
    );
    expect(providerCall).toBeDefined();

    const eventCalls = mockMutation.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        'events' in (call[1] as Record<string, unknown>),
    );
    const events = eventCalls.flatMap(
      (call) => (call[1] as { events: Array<{ type: string }> }).events,
    );
    expect(events.some((event) => event.type === 'codex.turn/completed')).toBe(
      true,
    );
  });
});
