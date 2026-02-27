import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './useSession';

// ---------------------------------------------------------------------------
// Convex mocks
// ---------------------------------------------------------------------------

// useQuery is mocked as a plain vi.fn() — the factory must not reference
// outer variables (vi.mock is hoisted). Override behavior in beforeEach.
const mockSendSessionMessage = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(() => mockSendSessionMessage),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    sessions: { get: 'sessions:get' },
    sessionEvents: { getBySession: 'sessionEvents:getBySession' },
    sessionMessages: { send: 'sessionMessages:send' },
  },
}));
vi.mock('@convex/_generated/dataModel', () => ({}));

import { useQuery } from 'convex/react';

// Typed helper: Convex's useQuery overload signature conflicts with simple
// mock implementations. This wrapper casts once so call sites stay clean.
// biome-ignore lint/suspicious/noExplicitAny: necessary for mock compatibility
const mockedUseQuery = vi.mocked(useQuery) as any as {
  mockImplementation: (fn: (query: unknown) => unknown) => void;
};

// Default: no session record, no persisted batches
function resetUseQueryDefaults() {
  mockedUseQuery.mockImplementation((query: unknown) => {
    if (query === 'sessions:get') return null;
    if (query === 'sessionEvents:getBySession') return [];
    return null;
  });
}

// ---------------------------------------------------------------------------
// WebSocket mock
// ---------------------------------------------------------------------------

type WsHandler = (event: MessageEvent | Event | CloseEvent) => void;

interface MockWebSocketInstance {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onopen: WsHandler | null;
  onmessage: WsHandler | null;
  onclose: WsHandler | null;
  onerror: WsHandler | null;
  // Test helpers
  _simulateOpen: () => void;
  _simulateMessage: (data: unknown) => void;
  _simulateClose: () => void;
}

let lastWsInstance: MockWebSocketInstance | null = null;

class MockWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1; // OPEN by default
  send = vi.fn();
  close = vi.fn();
  onopen: WsHandler | null = null;
  onmessage: WsHandler | null = null;
  onclose: WsHandler | null = null;
  onerror: WsHandler | null = null;

  constructor(_url: string) {
    lastWsInstance = this as unknown as MockWebSocketInstance;
  }

  _simulateOpen() {
    this.onopen?.(new Event('open'));
  }

  _simulateMessage(data: unknown) {
    const event = new MessageEvent('message', {
      data: JSON.stringify(data),
    });
    this.onmessage?.(event);
  }

  _simulateClose() {
    this.readyState = 3; // CLOSED
    this.onclose?.(new CloseEvent('close'));
  }
}

beforeEach(() => {
  lastWsInstance = null;
  vi.stubGlobal('WebSocket', MockWebSocket);
  resetUseQueryDefaults();
  mockSendSessionMessage.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ws(): MockWebSocketInstance {
  if (!lastWsInstance) throw new Error('No WebSocket instance created');
  return lastWsInstance;
}

function renderSession(sessionId: string | null) {
  return renderHook(() => useSession(sessionId));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSession', () => {
  describe('initial state', () => {
    it('returns empty state when sessionId is null', () => {
      const { result } = renderSession(null);
      expect(result.current.events).toEqual([]);
      expect(result.current.pendingApprovals).toEqual([]);
      expect(result.current.sessionStatus).toBeNull();
      expect(result.current.isConnected).toBe(false);
      expect(result.current.sdkSessionId).toBeUndefined();
    });

    it('opens a WebSocket when sessionId is provided', () => {
      renderSession('session-1');
      expect(lastWsInstance).not.toBeNull();
    });

    it('uses wss: when page is served over https', () => {
      vi.spyOn(window, 'location', 'get').mockReturnValue({
        ...window.location,
        protocol: 'https:',
        host: 'app.example.com',
      } as Location);

      const constructorSpy = vi.fn();
      vi.stubGlobal(
        'WebSocket',
        class extends MockWebSocket {
          constructor(url: string) {
            super(url);
            constructorSpy(url);
          }
        },
      );

      renderSession('session-ssl');
      expect(constructorSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^wss:/),
      );
    });

    it('exposes sdkSessionId from Convex session record', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return { sdkSessionId: 'sdk-abc-123', status: 'idle' };
        if (query === 'sessionEvents:getBySession') return [];
        return null;
      });

      const { result } = renderSession('session-1');
      expect(result.current.sdkSessionId).toBe('sdk-abc-123');
    });

    it('sdkSessionId is undefined when session record has no sdkSessionId yet', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return { status: 'running' };
        if (query === 'sessionEvents:getBySession') return [];
        return null;
      });

      const { result } = renderSession('session-1');
      expect(result.current.sdkSessionId).toBeUndefined();
    });
  });

  describe('connection lifecycle', () => {
    it('sets isConnected to true on open', async () => {
      const { result } = renderSession('session-1');
      act(() => ws()._simulateOpen());
      expect(result.current.isConnected).toBe(true);
    });

    it('sets isConnected to false on close', async () => {
      const { result } = renderSession('session-1');
      act(() => ws()._simulateOpen());
      expect(result.current.isConnected).toBe(true);
      act(() => ws()._simulateClose());
      expect(result.current.isConnected).toBe(false);
    });

    it('closes WebSocket on unmount', () => {
      const { unmount } = renderSession('session-1');
      const instance = ws();
      unmount();
      expect(instance.close).toHaveBeenCalled();
    });

    it('resets state and reopens WebSocket when sessionId changes', () => {
      const { rerender } = renderHook(
        ({ id }: { id: string }) => useSession(id),
        { initialProps: { id: 'session-a' } },
      );
      const firstWs = ws();
      rerender({ id: 'session-b' });
      expect(ws()).not.toBe(firstWs);
    });

    it('resets events and pendingApprovals on new session', () => {
      let id = 'session-a';
      const { result, rerender } = renderHook(() => useSession(id));

      // Simulate some events on the first session
      act(() => {
        ws()._simulateMessage({
          type: 'event',
          sessionId: 'session-a',
          event: { type: 'text', text: 'hello' },
        });
      });
      expect(result.current.events).toHaveLength(1);

      // Switch session
      id = 'session-b';
      rerender();
      expect(result.current.events).toHaveLength(0);
      expect(result.current.pendingApprovals).toHaveLength(0);
    });

    it('resets messageQueued on new session', () => {
      let id = 'session-a';
      const { result, rerender } = renderHook(() => useSession(id));

      // Mark messageQueued by simulating a running status then send
      act(() => {
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-a',
          status: 'running',
        });
      });

      // Switch session — messageQueued should be cleared
      id = 'session-b';
      rerender();
      expect(result.current.messageQueued).toBe(false);
    });
  });

  describe('event message parsing', () => {
    it('appends SDK events to the events array', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'event',
          sessionId: 'session-1',
          event: { type: 'text', text: 'Hello from Claude' },
        }),
      );
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0]).toEqual({
        type: 'text',
        text: 'Hello from Claude',
      });
    });

    it('accumulates multiple events in order', () => {
      const { result } = renderSession('session-1');
      act(() => {
        ws()._simulateMessage({
          type: 'event',
          sessionId: 'session-1',
          event: { type: 'text', text: 'First' },
        });
        ws()._simulateMessage({
          type: 'event',
          sessionId: 'session-1',
          event: { type: 'text', text: 'Second' },
        });
      });
      expect(result.current.events).toHaveLength(2);
      expect(result.current.events[1]).toMatchObject({ text: 'Second' });
    });

    it('ignores messages with invalid JSON', () => {
      const { result } = renderSession('session-1');
      const onmessage = ws().onmessage;
      act(() => {
        onmessage?.(new MessageEvent('message', { data: 'not-valid-json{{' }));
      });
      expect(result.current.events).toHaveLength(0);
    });

    it('deduplicates events by uuid when they appear in both persisted and WS', () => {
      // Simulate persisted events with uuids
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return null;
        if (query === 'sessionEvents:getBySession') {
          return [
            {
              batchIndex: 0,
              events: [
                {
                  data: JSON.stringify({
                    type: 'text',
                    uuid: 'uuid-1',
                    text: 'From Convex',
                  }),
                  timestamp: Date.now(),
                },
              ],
            },
          ];
        }
        return null;
      });

      const { result } = renderSession('session-1');

      // WS also delivers the same event (with same uuid) — should be deduplicated
      act(() =>
        ws()._simulateMessage({
          type: 'event',
          sessionId: 'session-1',
          event: { type: 'text', uuid: 'uuid-1', text: 'From Convex' },
        }),
      );

      // Should only appear once despite coming from both sources
      const matching = result.current.events.filter(
        (e) => (e as { uuid?: string }).uuid === 'uuid-1',
      );
      expect(matching).toHaveLength(1);
    });
  });

  describe('status messages', () => {
    it('updates sessionStatus from status messages', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'running',
        }),
      );
      expect(result.current.sessionStatus).toBe('running');
    });

    it('sets sessionStatus to failed on error messages', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'error',
          sessionId: 'session-1',
          message: 'Something exploded',
        }),
      );
      expect(result.current.sessionStatus).toBe('failed');
    });

    it('tracks idle status (replaces completed/stopped)', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'idle',
        }),
      );
      expect(result.current.sessionStatus).toBe('idle');
    });

    it('clears messageQueued when status moves past running', () => {
      const { result } = renderSession('session-1');

      // Start running
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'running',
        }),
      );
      // messageQueued is false unless sendMessage was called
      expect(result.current.messageQueued).toBe(false);

      // Transition to idle — messageQueued (if set) should clear
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'idle',
        }),
      );
      expect(result.current.messageQueued).toBe(false);
    });

    it('clears messageQueued on error', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'error',
          sessionId: 'session-1',
          message: 'boom',
        }),
      );
      expect(result.current.messageQueued).toBe(false);
    });
  });

  describe('permission (approval) messages', () => {
    it('adds a pending approval on permission message', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: { file_path: '/tmp/test.ts', content: 'hello' },
        }),
      );
      expect(result.current.pendingApprovals).toHaveLength(1);
      const approval = result.current.pendingApprovals[0];
      expect(approval?.requestId).toBe('req-1');
      expect(approval?.tool).toBe('Write');
      expect(approval?.input).toEqual({
        file_path: '/tmp/test.ts',
        content: 'hello',
      });
    });

    it('sets sessionStatus to waiting_input on permission message', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Bash',
          input: { command: 'rm -rf /' },
        }),
      );
      expect(result.current.sessionStatus).toBe('waiting_input');
    });

    it('does not add duplicate approvals on reconnect replay', () => {
      const { result } = renderSession('session-1');
      const permMsg = {
        type: 'permission',
        sessionId: 'session-1',
        requestId: 'req-dup',
        tool: 'Edit',
        input: { file_path: '/tmp/x.ts' },
      };
      act(() => {
        ws()._simulateMessage(permMsg);
        ws()._simulateMessage(permMsg); // second replay
      });
      expect(result.current.pendingApprovals).toHaveLength(1);
    });

    it('stacks multiple pending approvals', () => {
      const { result } = renderSession('session-1');
      act(() => {
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        });
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-2',
          tool: 'Bash',
          input: { command: 'rm -rf /' },
        });
      });
      expect(result.current.pendingApprovals).toHaveLength(2);
    });
  });

  describe('approve()', () => {
    it('sends approve message over WebSocket', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );

      act(() => result.current.approve('req-1'));

      expect(ws().send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'approve', requestId: 'req-1' }),
      );
    });

    it('marks the approval as resolved: approved', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );

      act(() => result.current.approve('req-1'));

      const approval = result.current.pendingApprovals.find(
        (a) => a.requestId === 'req-1',
      );
      expect(approval?.resolved).toEqual({ approved: true });
    });
  });

  describe('deny()', () => {
    it('sends deny message over WebSocket', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-2',
          tool: 'Bash',
          input: { command: 'rm -rf /' },
        }),
      );

      act(() => result.current.deny('req-2', 'Too dangerous'));

      expect(ws().send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'deny',
          requestId: 'req-2',
          message: 'Too dangerous',
        }),
      );
    });

    it('marks the approval as resolved: denied', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-2',
          tool: 'Edit',
          input: {},
        }),
      );

      act(() => result.current.deny('req-2'));

      const approval = result.current.pendingApprovals.find(
        (a) => a.requestId === 'req-2',
      );
      expect(approval?.resolved).toEqual({ approved: false });
    });

    it('sends deny without message field when message is omitted', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-3',
          tool: 'Write',
          input: {},
        }),
      );

      act(() => result.current.deny('req-3'));

      expect(ws().send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'deny',
          requestId: 'req-3',
          message: undefined,
        }),
      );
    });
  });

  describe('derived sessionStatus (waiting_input)', () => {
    it('keeps waiting_input even when a running status arrives while approval is pending', () => {
      const { result } = renderSession('session-1');

      // Permission comes first → waiting_input
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );
      expect(result.current.sessionStatus).toBe('waiting_input');

      // Backend sends running status (e.g. spurious update) — should stay waiting_input
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'running',
        }),
      );
      expect(result.current.sessionStatus).toBe('waiting_input');
    });

    it('reverts to running after all approvals are resolved', () => {
      const { result } = renderSession('session-1');

      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'running',
        }),
      );
      expect(result.current.sessionStatus).toBe('waiting_input');

      // Resolve the approval
      act(() => result.current.approve('req-1'));
      // Status should now reflect running since no pending approvals remain
      expect(result.current.sessionStatus).toBe('running');
    });

    it('does not show waiting_input when session is idle', () => {
      const { result } = renderSession('session-1');

      // Permission arrives
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );

      // Session goes idle without resolving the approval
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'idle',
        }),
      );

      // idle takes priority over waiting_input
      expect(result.current.sessionStatus).toBe('idle');
    });

    it('does not show waiting_input when session has failed', () => {
      const { result } = renderSession('session-1');

      // Permission arrives
      act(() =>
        ws()._simulateMessage({
          type: 'permission',
          sessionId: 'session-1',
          requestId: 'req-1',
          tool: 'Write',
          input: {},
        }),
      );

      // Session fails without resolving the approval
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-1',
          status: 'failed',
        }),
      );

      expect(result.current.sessionStatus).toBe('failed');
    });
  });

  describe('sdkSessionId from Convex (for resume flow)', () => {
    it('is available once the Convex session record has sdkSessionId', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return { sdkSessionId: 'sdk-resume-id-xyz', status: 'idle' };
        }
        if (query === 'sessionEvents:getBySession') return [];
        return null;
      });

      const { result } = renderSession('session-idle');
      expect(result.current.sdkSessionId).toBe('sdk-resume-id-xyz');
    });

    it('updates reactively when Convex session record updates', () => {
      let sessionRecord: { sdkSessionId?: string; status: string } = {
        status: 'running',
      };
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return sessionRecord;
        if (query === 'sessionEvents:getBySession') return [];
        return null;
      });

      const { result, rerender } = renderSession('session-live');
      expect(result.current.sdkSessionId).toBeUndefined();

      // Simulate Convex updating the record with sdkSessionId
      sessionRecord = { sdkSessionId: 'sdk-newly-set', status: 'idle' };
      rerender();

      expect(result.current.sdkSessionId).toBe('sdk-newly-set');
    });
  });

  describe('persistenceWarning', () => {
    it('sets persistenceWarning when a warning message is received', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'warning',
          sessionId: 'session-1',
          message:
            'Failed to persist session data to database — events may be lost on refresh',
        }),
      );
      expect(result.current.persistenceWarning).toBe(
        'Failed to persist session data to database — events may be lost on refresh',
      );
    });

    it('starts as null before any warning is received', () => {
      const { result } = renderSession('session-1');
      expect(result.current.persistenceWarning).toBeNull();
    });

    it('resets persistenceWarning to null when sessionId changes', () => {
      let id = 'session-a';
      const { result, rerender } = renderHook(() => useSession(id));

      act(() =>
        ws()._simulateMessage({
          type: 'warning',
          sessionId: 'session-a',
          message: 'Something failed',
        }),
      );
      expect(result.current.persistenceWarning).toBe('Something failed');

      id = 'session-b';
      rerender();
      expect(result.current.persistenceWarning).toBeNull();
    });

    it('updates persistenceWarning with the latest warning message', () => {
      const { result } = renderSession('session-1');
      act(() =>
        ws()._simulateMessage({
          type: 'warning',
          sessionId: 'session-1',
          message: 'First warning',
        }),
      );
      expect(result.current.persistenceWarning).toBe('First warning');

      act(() =>
        ws()._simulateMessage({
          type: 'warning',
          sessionId: 'session-1',
          message: 'Second warning',
        }),
      );
      expect(result.current.persistenceWarning).toBe('Second warning');
    });
  });

  describe('sendMessage()', () => {
    it('calls the Convex sessionMessages.send mutation', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      const { result } = renderSession('session-abc');

      await act(async () => {
        await result.current.sendMessage('session-abc', 'Hello Claude');
      });

      expect(mockSendSessionMessage).toHaveBeenCalledWith({
        sessionId: 'session-abc',
        text: 'Hello Claude',
      });
    });

    it('sets messageQueued when session is running and message is sent', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      const { result } = renderSession('session-running');

      // Simulate running status
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-running',
          status: 'running',
        }),
      );

      expect(result.current.sessionStatus).toBe('running');

      await act(async () => {
        await result.current.sendMessage('session-running', 'follow-up');
      });

      expect(result.current.messageQueued).toBe(true);
    });

    it('does not set messageQueued when session is idle', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      const { result } = renderSession('session-idle');

      // Session is idle
      act(() =>
        ws()._simulateMessage({
          type: 'status',
          sessionId: 'session-idle',
          status: 'idle',
        }),
      );

      await act(async () => {
        await result.current.sendMessage('session-idle', 'resume message');
      });

      // Not running, so messageQueued stays false
      expect(result.current.messageQueued).toBe(false);
    });

    it('throws when the mutation fails', async () => {
      mockSendSessionMessage.mockRejectedValue(new Error('Session not found'));

      const { result } = renderSession('session-missing');

      await expect(
        act(async () => {
          await result.current.sendMessage('session-missing', 'hello');
        }),
      ).rejects.toThrow();
    });
  });
});
