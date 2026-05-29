/**
 * Fake AppServerClient for E2E smoke testing.
 *
 * When CODEX_FAKE_TRANSPORT=1 is set, the Codex manager uses this instead of
 * spawning the real `codex` binary. It emits a scripted, deterministic event
 * stream that exercises the turn/started → item/agentMessage/delta →
 * item/started (fileChange) → item/completed → turn/completed pipeline and
 * the item/fileChange/requestApproval approval bridge.
 *
 * Turn behaviour:
 *   Turn 1 (first call to turn.start): emits agent message + fileChange item,
 *           then turn/completed. No approval required.
 *   Turn 2+ (subsequent calls to turn.start): emits fileChange item/started,
 *            then fires item/fileChange/requestApproval through the approval
 *            handler, waits for resolution, then emits item/completed and
 *            turn/completed.
 */

import { randomUUID } from 'node:crypto';
import type {
  AppServerClient,
  AppServerClientApprovalResponse,
  AppServerClientInboundApprovalRequest,
  AppServerClientNotification,
} from 'codex-app-server-client';

// biome-ignore lint/suspicious/noExplicitAny: mirrors AppServerClient event listener map
type Listener = (notification: any) => void;

/** Create a fake AppServerClient that the manager can use in place of the real one. */
export function createFakeClient(): AppServerClient {
  // Thread id assigned on thread.start and returned via thread/started notification.
  const threadId = `fake-thread-${randomUUID()}`;
  let turnCount = 0;

  // Event listeners registered via onEvent()
  const listeners = new Map<string, Set<Listener>>();

  // Approval handler registered via handleApprovalRequests()
  let approvalHandler:
    | ((
        req: AppServerClientInboundApprovalRequest,
      ) =>
        | AppServerClientApprovalResponse
        | Promise<AppServerClientApprovalResponse>)
    | null = null;

  function emit(method: string, params: unknown): void {
    const set = listeners.get(method);
    if (!set) return;
    const notification = { method, params };
    for (const fn of set) {
      fn(notification as AppServerClientNotification);
    }
  }

  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function runTurn1(turnId: string): Promise<void> {
    const agentItemId = `fake-agent-${randomUUID()}`;
    const fileItemId = `fake-file-${randomUUID()}`;

    // turn/started
    emit('turn/started', {
      threadId,
      turn: {
        id: turnId,
        items: [],
        status: 'inProgress',
        error: null,
        startedAt: Math.floor(Date.now() / 1000),
        completedAt: null,
        durationMs: null,
      },
    });

    await delay(30);

    // Stream agent message text
    const text = 'Hello! I have written a one-line README for you.';
    for (let i = 0; i < text.length; i += 8) {
      emit('item/agentMessage/delta', {
        threadId,
        turnId,
        itemId: agentItemId,
        delta: text.slice(i, i + 8),
      });
      await delay(10);
    }

    // item/started for fileChange
    emit('item/started', {
      threadId,
      turnId,
      item: {
        type: 'fileChange',
        id: fileItemId,
        changes: [
          { path: 'README.md', kind: { type: 'add' }, diff: '+# Hello\n' },
        ],
        status: 'inProgress',
      },
    });

    await delay(20);

    // item/completed for agentMessage
    emit('item/completed', {
      threadId,
      turnId,
      item: {
        type: 'agentMessage',
        id: agentItemId,
        text,
        phase: null,
        memoryCitation: null,
      },
    });

    // item/completed for fileChange
    emit('item/completed', {
      threadId,
      turnId,
      item: {
        type: 'fileChange',
        id: fileItemId,
        changes: [
          { path: 'README.md', kind: { type: 'add' }, diff: '+# Hello\n' },
        ],
        status: 'completed',
      },
    });

    await delay(20);

    // turn/completed
    emit('turn/completed', {
      threadId,
      turn: {
        id: turnId,
        items: [],
        status: 'completed',
        error: null,
        startedAt: Math.floor(Date.now() / 1000) - 1,
        completedAt: Math.floor(Date.now() / 1000),
        durationMs: 1000,
      },
    });
  }

  async function runTurn2(turnId: string): Promise<void> {
    const fileItemId = `fake-file-${randomUUID()}`;
    const agentItemId = `fake-agent-${randomUUID()}`;

    // turn/started
    emit('turn/started', {
      threadId,
      turn: {
        id: turnId,
        items: [],
        status: 'inProgress',
        error: null,
        startedAt: Math.floor(Date.now() / 1000),
        completedAt: null,
        durationMs: null,
      },
    });

    await delay(30);

    // item/started for fileChange
    emit('item/started', {
      threadId,
      turnId,
      item: {
        type: 'fileChange',
        id: fileItemId,
        changes: [
          {
            path: 'README.md',
            kind: { type: 'update', move_path: null },
            diff: '-# Hello\n+# Hello World\n',
          },
        ],
        status: 'inProgress',
      },
    });

    await delay(20);

    // Fire item/fileChange/requestApproval through the approval handler
    if (approvalHandler) {
      const requestId =
        randomUUID() as unknown as import('codex-app-server-client').AppServerClientInboundApprovalRequest['id'];
      const rawParams = {
        threadId,
        turnId,
        itemId: fileItemId,
        reason: null,
        grantRoot: null,
      };

      // Construct the normalized approval request shape expected by handleApprovalRequests
      const request: AppServerClientInboundApprovalRequest = {
        id: requestId,
        method: 'item/fileChange/requestApproval',
        kind: 'fileChange',
        threadId,
        turnId,
        itemId: fileItemId,
        reason: null,
        message: null,
        questions: [],
        rawParams,
        approve: () => ({ decision: 'accept' as const }),
        deny: () => ({ decision: 'decline' as const }),
        respond: async () => {
          /* no-op in fake */
        },
        respondError: async () => {
          /* no-op in fake */
        },
      } as unknown as AppServerClientInboundApprovalRequest;

      // Call the approval handler and wait for resolution
      await approvalHandler(request);
    }

    await delay(20);

    // item/completed for fileChange (after approval)
    emit('item/completed', {
      threadId,
      turnId,
      item: {
        type: 'fileChange',
        id: fileItemId,
        changes: [
          {
            path: 'README.md',
            kind: { type: 'update', move_path: null },
            diff: '-# Hello\n+# Hello World\n',
          },
        ],
        status: 'completed',
      },
    });

    // Agent message confirming completion
    emit('item/agentMessage/delta', {
      threadId,
      turnId,
      itemId: agentItemId,
      delta: 'Done! Updated README.md.',
    });

    await delay(10);

    emit('item/completed', {
      threadId,
      turnId,
      item: {
        type: 'agentMessage',
        id: agentItemId,
        text: 'Done! Updated README.md.',
        phase: null,
        memoryCitation: null,
      },
    });

    await delay(20);

    // turn/completed
    emit('turn/completed', {
      threadId,
      turn: {
        id: turnId,
        items: [],
        status: 'completed',
        error: null,
        startedAt: Math.floor(Date.now() / 1000) - 1,
        completedAt: Math.floor(Date.now() / 1000),
        durationMs: 1000,
      },
    });
  }

  const fakeClient = {
    thread: {
      start: async (_opts?: unknown) => {
        // Emit thread/started
        emit('thread/started', {
          thread: {
            id: threadId,
            forkedFromId: null,
            preview: '',
            ephemeral: false,
            modelProvider: 'openai',
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            status: { type: 'idle' },
            path: null,
            cwd: '/',
            cliVersion: '0.0.0',
            source: 'cli',
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: null,
            turns: [],
          },
        });
        return { thread: { id: threadId } };
      },

      resume: async (params: { threadId: string }) => {
        emit('thread/started', {
          thread: {
            id: params.threadId,
            forkedFromId: null,
            preview: '',
            ephemeral: false,
            modelProvider: 'openai',
            createdAt: Math.floor(Date.now() / 1000),
            updatedAt: Math.floor(Date.now() / 1000),
            status: { type: 'idle' },
            path: null,
            cwd: '/',
            cliVersion: '0.0.0',
            source: 'cli',
            agentNickname: null,
            agentRole: null,
            gitInfo: null,
            name: null,
            turns: [],
          },
        });
        return { thread: { id: params.threadId } };
      },

      run: async () => {
        throw new Error('fakeTransport: thread.run not supported');
      },
      read: async () => {
        throw new Error('fakeTransport: thread.read not supported');
      },
      list: async () => ({ threads: [] }),
      loadedList: async () => ({ threads: [] }),
    },

    turn: {
      start: async (_params: { threadId: string }) => {
        const thisTurn = ++turnCount;
        const turnId = `fake-turn-${randomUUID()}`;
        // Run the scripted event stream asynchronously (don't await — manager
        // subscribes to events and doesn't await turn.start for completion)
        void (thisTurn === 1 ? runTurn1(turnId) : runTurn2(turnId));
        return { turn: { id: turnId } };
      },
      interrupt: async () => ({}),
      steer: async () => ({}),
      run: async () => {
        throw new Error('fakeTransport: turn.run not supported');
      },
    },

    command: {
      exec: async () => {
        throw new Error('fakeTransport: command.exec not supported');
      },
      write: async () => {
        throw new Error('fakeTransport: command.write not supported');
      },
      resize: async () => {
        throw new Error('fakeTransport: command.resize not supported');
      },
      terminate: async () => {
        throw new Error('fakeTransport: command.terminate not supported');
      },
    },

    fs: {
      readFile: async () => {
        throw new Error('fakeTransport: fs.readFile not supported');
      },
      writeFile: async () => {
        throw new Error('fakeTransport: fs.writeFile not supported');
      },
      createDirectory: async () => {
        throw new Error('fakeTransport: fs.createDirectory not supported');
      },
      getMetadata: async () => {
        throw new Error('fakeTransport: fs.getMetadata not supported');
      },
      readDirectory: async () => {
        throw new Error('fakeTransport: fs.readDirectory not supported');
      },
      remove: async () => {
        throw new Error('fakeTransport: fs.remove not supported');
      },
      copy: async () => {
        throw new Error('fakeTransport: fs.copy not supported');
      },
    },

    account: {
      read: async () => {
        throw new Error('fakeTransport: account.read not supported');
      },
      loginStart: async () => {
        throw new Error('fakeTransport: account.loginStart not supported');
      },
      loginCancel: async () => {
        throw new Error('fakeTransport: account.loginCancel not supported');
      },
      logout: async () => {
        throw new Error('fakeTransport: account.logout not supported');
      },
      rateLimitsRead: async () => {
        throw new Error('fakeTransport: account.rateLimitsRead not supported');
      },
    },

    get state() {
      return 'ready' as const;
    },
    get initializationState() {
      return 'done' as const;
    },

    start: async () => {},
    close: async () => {},

    initialize: async () => ({
      serverInfo: { name: 'fake', version: '0.0.0' },
      capabilities: {},
    }),

    initialized: async () => {},

    appList: async () => ({ apps: [] }),
    modelList: async () => ({ models: [] }),
    skillsList: async () => ({ skills: [] }),

    onNotification: (_listener: Listener) => () => {},

    onEvent: (method: string, listener: Listener) => {
      if (!listeners.has(method)) listeners.set(method, new Set());
      // biome-ignore lint/style/noNonNullAssertion: just set above
      listeners.get(method)!.add(listener);
      return () => {
        listeners.get(method)?.delete(listener);
      };
    },

    onRequest: (_listener: Listener) => () => {},

    onApprovalRequest: (_listener: Listener) => () => {},

    onServerRequest: (_method: string, _listener: Listener) => () => {},

    handleRequest: (_method: string, _handler: unknown) => () => {},

    handleApprovals: (_handlers: unknown) => () => {},

    handleApprovalRequests: (
      handler: (
        req: AppServerClientInboundApprovalRequest,
      ) =>
        | AppServerClientApprovalResponse
        | Promise<AppServerClientApprovalResponse>,
    ) => {
      approvalHandler = handler;
      return () => {
        approvalHandler = null;
      };
    },

    onError: (_listener: Listener) => () => {},

    onClose: (_listener: Listener) => () => {},
  };

  return fakeClient as unknown as AppServerClient;
}
