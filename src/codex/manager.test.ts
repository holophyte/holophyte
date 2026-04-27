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

  it('keeps the session alive after an idle turn/completed so follow-ups can run', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession, sendMessageToSession, getSession } = await import(
      './manager'
    );

    await startSession({
      sessionId: 'codex-multiturn',
      repoPath: '/tmp/repo',
      prompt: 'first turn',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    // Let the first turn complete (turn.start emits turn/started + turn/completed)
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Session must still be in the map — only 'failed' status tears it down
    expect(getSession('codex-multiturn')).toBeDefined();

    // Follow-up message must be accepted (returns true) and trigger a second turn.start
    const delivered = sendMessageToSession('codex-multiturn', 'second turn');
    expect(delivered).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(client.turn.start).toHaveBeenCalledTimes(2);
    expect(client.turn.start).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 'thread-123',
        input: [{ type: 'text', text: 'second turn', text_elements: [] }],
      }),
    );
  });

  it('finishSession is idempotent when stopSession races a failed turn/completed', async () => {
    // Race: handleNotification fires finishSession on a 'failed' turn while
    // stopSession's finally also calls finishSession. Both pass the
    // `if (!session) return` guard before any await unless the map is cleared
    // synchronously at the top.
    const handlers = new Map<
      string,
      Array<(notification: Notification) => void>
    >();
    const emit = (notification: Notification) => {
      for (const handler of handlers.get(notification.method) ?? []) {
        handler(notification);
      }
    };
    const client = {
      thread: {
        start: vi.fn().mockResolvedValue({
          thread: { id: 'thread-race' },
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
              threadId: 'thread-race',
              turn: makeTurn('turn-race', 'inProgress'),
            },
          });
          return { turn: makeTurn('turn-race', 'inProgress') };
        }),
        interrupt: vi.fn(async () => {
          // Synthesize a 'failed' turn/completed (rather than 'interrupted')
          // to drive both finishSession entry points concurrently.
          emit({
            method: 'turn/completed',
            params: {
              threadId: 'thread-race',
              turn: makeTurn('turn-race', 'failed'),
            },
          });
          return {};
        }),
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
    mockCreateClient.mockResolvedValue(client);

    const { startSession, stopSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-race',
      repoPath: '/tmp/repo',
      prompt: 'long task',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    await new Promise((r) => setTimeout(r, 30));

    stopSession('codex-race');

    await new Promise((r) => setTimeout(r, 700));

    // Exactly one teardown despite both paths racing in.
    expect(client.close).toHaveBeenCalledTimes(1);
    const finalStatusCalls = mockMutation.mock.calls.filter(
      (call) =>
        typeof call[1] === 'object' &&
        ((call[1] as Record<string, unknown>).status === 'idle' ||
          (call[1] as Record<string, unknown>).status === 'failed'),
    );
    expect(finalStatusCalls).toHaveLength(1);
  });
});
