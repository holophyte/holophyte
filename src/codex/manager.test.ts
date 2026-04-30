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

type ApprovalHandler = (request: unknown) => unknown;

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
  const approvalHandlers: ApprovalHandler[] = [];

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
    handleApprovalRequests: vi.fn((handler: ApprovalHandler) => {
      approvalHandlers.push(handler);
      return () => {
        const idx = approvalHandlers.indexOf(handler);
        if (idx >= 0) approvalHandlers.splice(idx, 1);
      };
    }),
    /** Returns the most recently registered approval handler. */
    invokeApproval: (request: unknown) => {
      const handler = approvalHandlers[approvalHandlers.length - 1];
      if (!handler) throw new Error('No approval handler registered');
      return handler(request);
    },
    approvalHandlerCount: () => approvalHandlers.length,
    close: vi.fn().mockResolvedValue(undefined),
  };
}

interface ApprovalResponse {
  decision: 'approve' | 'deny';
  method: string;
}

interface ApprovalRequestStub {
  id: string;
  itemId: string | null;
  method: string;
  rawParams: unknown;
  approve: () => ApprovalResponse;
  deny: () => ApprovalResponse;
}

function makeApprovalRequest(
  method: string,
  id: string,
  rawParams: unknown,
  itemId: string | null = null,
): ApprovalRequestStub {
  return {
    id,
    itemId,
    method,
    rawParams,
    approve: vi.fn(() => ({ decision: 'approve' as const, method })),
    deny: vi.fn(() => ({ decision: 'deny' as const, method })),
  };
}

afterEach(async () => {
  const { getActiveSessions, stopSession } = await import('./manager');
  for (const id of getActiveSessions()) {
    stopSession(id);
  }
  // Poll until the in-memory map is drained (commit 2 makes finishSession
  // delete synchronously; this returns fast). Then wait a STOP_GRACE_MS-
  // shaped tail to let the still-pending cleanup mutations (status update,
  // client.close) settle before the next test installs new mocks.
  const deadline = Date.now() + 2000;
  while (getActiveSessions().length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 25));
  }
  await new Promise((r) => setTimeout(r, 600));
  mockCreateClient.mockReset();
  mockMutation.mockReset();
  mockQuery.mockReset();
  mockMutation.mockResolvedValue(undefined);
  mockQuery.mockResolvedValue({ nextBatchIndex: 0 });
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

    // Follow-up message must be accepted (resolves true) and trigger a second turn.start
    const delivered = await sendMessageToSession(
      'codex-multiturn',
      'second turn',
    );
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
      handleApprovalRequests: vi.fn(() => () => {}),
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

  it('does not advance batchIndex when companionInsertBatch fails', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    // Reject the first event-batch insert, then succeed for subsequent calls.
    let firstInsertSeen = false;
    mockMutation.mockImplementation(
      (_path: unknown, args: Record<string, unknown> | undefined) => {
        if (
          args &&
          typeof args === 'object' &&
          'events' in args &&
          'batchIndex' in args
        ) {
          if (!firstInsertSeen) {
            firstInsertSeen = true;
            return Promise.reject(new Error('convex transient failure'));
          }
        }
        return Promise.resolve(undefined);
      },
    );

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-batchindex',
      repoPath: '/tmp/repo',
      prompt: 'test',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    // Wait for retries / subsequent flushes to settle.
    await new Promise((r) => setTimeout(r, 200));

    const insertCalls = mockMutation.mock.calls.filter((call) => {
      const arg = call[1];
      return (
        arg &&
        typeof arg === 'object' &&
        'events' in (arg as Record<string, unknown>) &&
        'batchIndex' in (arg as Record<string, unknown>)
      );
    });
    const indices = insertCalls
      .map((c) => (c[1] as { batchIndex: number }).batchIndex)
      .sort((a, b) => a - b);
    // First insert rejected; the rejected index must be reused on retry —
    // no gap (i.e. no jump from 0 to 2).
    expect(indices).not.toContain(2);
    expect(indices.filter((i) => i === 0).length).toBeGreaterThanOrEqual(1);
  });

  it('resumes via thread.resume and honors the next batch index from Convex', async () => {
    const client = makeClientStub();
    client.thread.resume = vi.fn().mockResolvedValue({
      thread: { id: 'thread-resumed' },
      model: 'gpt-5.4-mini',
      modelProvider: 'openai',
      serviceTier: null,
      cwd: '/tmp/repo',
      approvalPolicy: 'never',
      approvalsReviewer: 'client',
      sandbox: { type: 'danger-full-access' },
      reasoningEffort: 'medium',
    });
    mockCreateClient.mockResolvedValue(client);
    mockQuery.mockResolvedValueOnce({ nextBatchIndex: 7 });

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-resume-test',
      repoPath: '/tmp/repo',
      prompt: 'continue',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
      resumeProviderSessionId: 'thread-resumed',
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(client.thread.resume).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-resumed' }),
    );
    expect(client.thread.start).not.toHaveBeenCalled();

    // companionGetNextBatchIndex must have been queried
    const queryCalls = mockQuery.mock.calls;
    expect(queryCalls.length).toBeGreaterThan(0);

    // First insertBatch should use the returned nextBatchIndex (7), not 0
    const insertCalls = mockMutation.mock.calls.filter((call) => {
      const arg = call[1];
      return (
        arg &&
        typeof arg === 'object' &&
        'events' in (arg as Record<string, unknown>) &&
        'batchIndex' in (arg as Record<string, unknown>)
      );
    });
    if (insertCalls.length > 0) {
      const firstBatchIndex = (insertCalls[0]?.[1] as { batchIndex: number })
        .batchIndex;
      expect(firstBatchIndex).toBe(7);
    }
  });

  it('rejects a second concurrent follow-up before turn/started lands', async () => {
    // Custom stub: turn.start does NOT emit turn/started synchronously —
    // it returns immediately so the test can fire two pending messages
    // before any event handler claims the slot. The real-world race the
    // adversarial review found: subscriptions.ts fans out pending messages
    // with `void handlePendingMessage(msg)`, so two follow-ups for the same
    // idle session can both pass the `currentTurnId` guard if nothing claims
    // the slot synchronously.
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
          thread: { id: 'thread-reentrancy' },
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
        start: vi.fn(async (params: { input: { text: string }[] }) => {
          // Emit turn/started AFTER the start response resolves so the
          // synchronous claim is the only thing protecting the slot.
          const turnId = `turn-${params.input[0]?.text ?? 'x'}`;
          queueMicrotask(() => {
            emit({
              method: 'turn/started',
              params: {
                threadId: 'thread-reentrancy',
                turn: makeTurn(turnId, 'inProgress'),
              },
            });
            emit({
              method: 'turn/completed',
              params: {
                threadId: 'thread-reentrancy',
                turn: makeTurn(turnId, 'completed'),
              },
            });
          });
          return { turn: makeTurn(turnId, 'inProgress') };
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
      handleApprovalRequests: vi.fn(() => () => {}),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateClient.mockResolvedValue(client);

    const { startSession, sendMessageToSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-reentrancy',
      repoPath: '/tmp/repo',
      prompt: 'first turn',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    // Wait for first turn to fully complete (turn/completed clears currentTurnId)
    await new Promise((r) => setTimeout(r, 50));

    // Fire two concurrent follow-ups. The second must be rejected synchronously
    // because the first claimed the turn slot before its async tail runs.
    const p1 = sendMessageToSession('codex-reentrancy', 'follow-up A');
    const p2 = sendMessageToSession('codex-reentrancy', 'follow-up B');
    const [accepted1, accepted2] = await Promise.all([p1, p2]);
    expect(accepted1).toBe(true);
    expect(accepted2).toBe(false);

    // Wait for the queueMicrotask emits so the turn settles
    await new Promise((r) => setTimeout(r, 50));

    // Only one follow-up turn.start call beyond the initial one
    expect(client.turn.start).toHaveBeenCalledTimes(2);
  });

  it('returns false when turn.start rejects so the pending message is not consumed', async () => {
    // First turn succeeds; the follow-up turn.start rejects to simulate a
    // transient app-server failure or an invalid thread state. The caller must
    // see false so subscriptions.ts leaves the pending message unconsumed and
    // the next polling tick can retry.
    const handlers = new Map<
      string,
      Array<(notification: Notification) => void>
    >();
    const emit = (notification: Notification) => {
      for (const handler of handlers.get(notification.method) ?? []) {
        handler(notification);
      }
    };
    let turnStartCalls = 0;
    const client = {
      thread: {
        start: vi.fn().mockResolvedValue({
          thread: { id: 'thread-fail' },
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
          turnStartCalls++;
          if (turnStartCalls === 1) {
            // First turn (from startSession) succeeds and completes
            emit({
              method: 'turn/started',
              params: {
                threadId: 'thread-fail',
                turn: makeTurn('turn-1', 'inProgress'),
              },
            });
            emit({
              method: 'turn/completed',
              params: {
                threadId: 'thread-fail',
                turn: makeTurn('turn-1', 'completed'),
              },
            });
            return { turn: makeTurn('turn-1', 'completed') };
          }
          throw new Error('app-server unreachable');
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
      handleApprovalRequests: vi.fn(() => () => {}),
      close: vi.fn().mockResolvedValue(undefined),
    };
    mockCreateClient.mockResolvedValue(client);

    const { startSession, sendMessageToSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-turn-fail',
      repoPath: '/tmp/repo',
      prompt: 'first',
      permissionMode: 'bypass',
      reasoningEffort: 'medium',
    });

    await new Promise((r) => setTimeout(r, 50));

    const accepted = await sendMessageToSession(
      'codex-turn-fail',
      'follow-up that fails',
    );
    expect(accepted).toBe(false);
  });

  it('preserves the session reasoningEffort when caller omits it on a follow-up', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession, sendMessageToSession } = await import('./manager');

    await startSession({
      sessionId: 'codex-effort-keep',
      repoPath: '/tmp/repo',
      prompt: 'first',
      permissionMode: 'bypass',
      reasoningEffort: 'high',
    });

    // Let first turn settle
    await new Promise((r) => setTimeout(r, 50));

    // Caller omits reasoningEffort — must reuse 'high', not undefined.
    const accepted = await sendMessageToSession(
      'codex-effort-keep',
      'follow up',
    );
    expect(accepted).toBe(true);
    await new Promise((r) => setTimeout(r, 50));

    expect(client.turn.start).toHaveBeenLastCalledWith(
      expect.objectContaining({ effort: 'high' }),
    );
  });

  it.each([
    ['default', 'untrusted'],
    ['safe-auto', 'on-request'],
    ['bypass', 'never'],
  ] as const)('maps permissionMode %s to approvalPolicy %s', async (mode, expectedPolicy) => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');

    await startSession({
      sessionId: `codex-mode-${mode}`,
      repoPath: '/tmp/repo',
      prompt: 'check policy',
      permissionMode: mode,
      reasoningEffort: 'medium',
    });

    await new Promise((r) => setTimeout(r, 30));

    expect(client.thread.start).toHaveBeenCalledWith(
      expect.objectContaining({ approvalPolicy: expectedPolicy }),
    );
    expect(client.turn.start).toHaveBeenCalledWith(
      expect.objectContaining({ approvalPolicy: expectedPolicy }),
    );
  });

  it('persists Codex item approvals keyed by itemId (not request.id) so the frontend can match by tool item', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-approval-persist',
      repoPath: '/tmp/repo',
      prompt: 'edit a file',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(client.approvalHandlerCount()).toBe(1);

    const rawParams = { path: 'src/foo.ts', content: 'hello' };
    // RPC id and tool itemId differ — frontend renders tool calls by itemId,
    // so pendingApprovals.requestId must use itemId to match.
    const inboundRequest = makeApprovalRequest(
      'item/fileChange/requestApproval',
      'rpc-id-fc-1',
      rawParams,
      'item-fc-1',
    );

    const responsePromise = client.invokeApproval(inboundRequest);
    // Let the persistence path queue up
    await new Promise((r) => setTimeout(r, 30));

    const createCall = mockMutation.mock.calls.find((call) => {
      const arg = call[1] as Record<string, unknown> | undefined;
      return arg && arg.requestId === 'item-fc-1';
    });
    expect(createCall).toBeDefined();
    const args = createCall?.[1] as Record<string, unknown>;
    expect(args.tool).toBe('codex.item/fileChange/requestApproval');
    expect(JSON.parse(args.input as string)).toEqual(rawParams);
    expect(args.sessionId).toBe('codex-approval-persist');

    // Resolve via Convex with approve, keyed on itemId.
    mockQuery.mockResolvedValue([
      {
        _id: 'pa-1',
        requestId: 'item-fc-1',
        approved: true,
        consumed: false,
        resolved: true,
      },
    ]);

    const response = (await responsePromise) as ApprovalResponse;
    expect(response).toEqual({
      decision: 'approve',
      method: 'item/fileChange/requestApproval',
    });
    expect(inboundRequest.approve).toHaveBeenCalledTimes(1);

    // companionMarkConsumed must have been called for the resolved row
    const markCall = mockMutation.mock.calls.find((call) => {
      const arg = call[1] as Record<string, unknown> | undefined;
      return arg && arg.id === 'pa-1';
    });
    expect(markCall).toBeDefined();
  });

  it('returns request.deny() when the user denies a Codex approval', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-approval-deny',
      repoPath: '/tmp/repo',
      prompt: 'try a command',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    const inboundRequest = makeApprovalRequest(
      'item/commandExecution/requestApproval',
      'rpc-id-ec-1',
      { command: 'echo hi', cwd: '/tmp/repo' },
      'item-ec-1',
    );
    const responsePromise = client.invokeApproval(inboundRequest);

    await new Promise((r) => setTimeout(r, 30));
    mockQuery.mockResolvedValue([
      {
        _id: 'pa-2',
        requestId: 'item-ec-1',
        approved: false,
        consumed: false,
        resolved: true,
      },
    ]);

    const response = (await responsePromise) as ApprovalResponse;
    expect(response).toEqual({
      decision: 'deny',
      method: 'item/commandExecution/requestApproval',
    });
    expect(inboundRequest.deny).toHaveBeenCalledTimes(1);
    expect(inboundRequest.approve).not.toHaveBeenCalled();
  });

  it.each([
    // Structured methods: response payload (answers, content, permission
    // scopes) needs UI Phase 0 cannot collect.
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'item/permissions/requestApproval',
    // Top-level methods: no `itemId`, so the rendered tool item in the
    // session thread has nothing to attach to in the existing approval UI.
    'applyPatchApproval',
    'execCommandApproval',
  ])('denies unsupported approval method %s without writing a pendingApprovals row', async (method) => {
    // Phase 0 limitation: structured methods need response payloads (answers,
    // content, permission scopes) the UI can't yet collect. Auto-approving
    // them with empty defaults is unsafe; deny immediately and surface the
    // failure to the agent so it can retry or fall back. Rich UI is Phase 0.1+.
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');
    await startSession({
      sessionId: `codex-structured-${method.replace(/\W/g, '-')}`,
      repoPath: '/tmp/repo',
      prompt: 'kick off',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    const inboundRequest = makeApprovalRequest(method, 'req-struct-1', {});
    const response = (await client.invokeApproval(
      inboundRequest,
    )) as ApprovalResponse;

    expect(response.decision).toBe('deny');
    expect(inboundRequest.deny).toHaveBeenCalledTimes(1);
    expect(inboundRequest.approve).not.toHaveBeenCalled();

    // Must not persist — no pendingApprovals row written for structured methods.
    const createCall = mockMutation.mock.calls.find((call) => {
      const arg = call[1] as Record<string, unknown> | undefined;
      return arg && arg.requestId === 'req-struct-1';
    });
    expect(createCall).toBeUndefined();
  });

  it('returns request.deny() when persisting the approval fails', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    // Default mockMutation resolves; override only the companionCreate path
    // (4-key arg shape with sessionId/requestId/tool/input).
    mockMutation.mockImplementation(
      (_path: unknown, args: Record<string, unknown> | undefined) => {
        if (
          args &&
          typeof args === 'object' &&
          'requestId' in args &&
          'tool' in args
        ) {
          return Promise.reject(new Error('convex unreachable'));
        }
        return Promise.resolve(undefined);
      },
    );

    const { startSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-create-fail',
      repoPath: '/tmp/repo',
      prompt: 'test',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    const inboundRequest = makeApprovalRequest(
      'item/fileChange/requestApproval',
      'rpc-id-fail-1',
      { path: 'a.ts' },
      'item-fail-1',
    );
    const response = (await client.invokeApproval(
      inboundRequest,
    )) as ApprovalResponse;
    expect(response.decision).toBe('deny');
    expect(inboundRequest.deny).toHaveBeenCalledTimes(1);
    expect(inboundRequest.approve).not.toHaveBeenCalled();
  });

  it('denies (no polling leak) if abort lands while companionCreate is in flight', async () => {
    // Race window: addEventListener('abort', ...) on an already-aborted
    // signal does not retroactively fire. Without a recheck after the
    // companionCreate await, the polling interval would run forever because
    // companionDenyAll later patches the row consumed: true, hiding it from
    // the poller. This test stalls companionCreate, fires stopSession during
    // the stall, then asserts deny() is returned and no interval is left.
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    let releaseCreate: (() => void) | undefined;
    mockMutation.mockImplementation(
      (_path: unknown, args: Record<string, unknown> | undefined) => {
        if (args && 'requestId' in args && 'tool' in args) {
          return new Promise<undefined>((resolve) => {
            releaseCreate = () => resolve(undefined);
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const { startSession, stopSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-abort-during-create',
      repoPath: '/tmp/repo',
      prompt: 'kick off',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    const inboundRequest = makeApprovalRequest(
      'item/fileChange/requestApproval',
      'rpc-id-race-1',
      { path: 'a.ts' },
      'item-race-1',
    );
    const responsePromise = client.invokeApproval(inboundRequest);

    // Stop the session while companionCreate is parked
    await new Promise((r) => setTimeout(r, 30));
    stopSession('codex-abort-during-create');
    await new Promise((r) => setTimeout(r, 20));

    // Release the parked mutation; the post-await abort recheck must trigger
    // request.deny() without arming the polling interval.
    releaseCreate?.();

    const response = (await responsePromise) as ApprovalResponse;
    expect(response.decision).toBe('deny');
    expect(inboundRequest.deny).toHaveBeenCalledTimes(1);
  });

  it('auto-denies in-flight approvals when the session controller aborts', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession, stopSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-approval-abort',
      repoPath: '/tmp/repo',
      prompt: 'kick off',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    const inboundRequest = makeApprovalRequest(
      'item/fileChange/requestApproval',
      'rpc-id-abort-1',
      { path: 'a.ts' },
      'item-abort-1',
    );
    const responsePromise = client.invokeApproval(inboundRequest);
    await new Promise((r) => setTimeout(r, 30));

    // No resolution from the user — abort the session instead.
    stopSession('codex-approval-abort');

    const response = (await responsePromise) as ApprovalResponse;
    expect(response.decision).toBe('deny');
    expect(inboundRequest.deny).toHaveBeenCalledTimes(1);
  });

  it('calls companionDenyAll when the session ends', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession, stopSession } = await import('./manager');
    await startSession({
      sessionId: 'codex-deny-all',
      repoPath: '/tmp/repo',
      prompt: 'short turn',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    });
    await new Promise((r) => setTimeout(r, 30));

    stopSession('codex-deny-all');
    await new Promise((r) => setTimeout(r, 700));

    // Convex FunctionReferences are empty objects at runtime, so discriminate
    // by args shape: companionDenyAll's args is exactly { sessionId }.
    const denyAllCall = mockMutation.mock.calls.find((call) => {
      const arg = call[1] as Record<string, unknown> | undefined;
      if (!arg || typeof arg !== 'object') return false;
      const keys = Object.keys(arg);
      return (
        keys.length === 1 &&
        keys[0] === 'sessionId' &&
        arg.sessionId === 'codex-deny-all'
      );
    });
    expect(denyAllCall).toBeDefined();
  });

  it('rejects startSession when permissionMode is omitted', async () => {
    const client = makeClientStub();
    mockCreateClient.mockResolvedValue(client);

    const { startSession } = await import('./manager');

    // Cast through `unknown` — TS already enforces the requirement, but the
    // runtime guard catches callers that drift in via dynamic dispatch (e.g.
    // a future Convex-driven dispatcher passing a partial config).
    await expect(
      startSession({
        sessionId: 'codex-no-mode',
        repoPath: '/tmp/repo',
        prompt: 'test',
        reasoningEffort: 'medium',
      } as unknown as Parameters<typeof startSession>[0]),
    ).rejects.toThrow(/Invalid permissionMode/);
  });
});
