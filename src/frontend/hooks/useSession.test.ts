import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSession } from './useSession';

// ---------------------------------------------------------------------------
// Convex mocks
// ---------------------------------------------------------------------------

// vi.mock is hoisted, so factory functions must not reference outer variables.
// Mutation mocks are created separately and shared via module-level refs.
const mockResolveApproval = vi.fn();
const mockSendSessionMessage = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock('@convex/_generated/api', () => ({
  api: {
    sessions: { get: 'sessions:get' },
    sessionEvents: { getBySession: 'sessionEvents:getBySession' },
    pendingApprovals: {
      getBySession: 'pendingApprovals:getBySession',
      resolve: 'pendingApprovals:resolve',
    },
    sessionMessages: { send: 'sessionMessages:send' },
  },
}));

vi.mock('@convex/_generated/dataModel', () => ({}));

import { useMutation, useQuery } from 'convex/react';

// biome-ignore lint/suspicious/noExplicitAny: necessary for mock compatibility
const mockedUseQuery = vi.mocked(useQuery) as any as {
  mockImplementation: (fn: (query: unknown) => unknown) => void;
};

// biome-ignore lint/suspicious/noExplicitAny: necessary for mock compatibility
const mockedUseMutation = vi.mocked(useMutation) as any as {
  mockImplementation: (fn: (mutation: unknown) => unknown) => void;
};

// Default session record — no session, no events, no approvals
function resetMocks() {
  mockedUseQuery.mockImplementation((query: unknown) => {
    if (query === 'sessions:get') return null;
    if (query === 'sessionEvents:getBySession') return [];
    if (query === 'pendingApprovals:getBySession') return [];
    return null;
  });

  mockedUseMutation.mockImplementation((mutation: unknown) => {
    if (mutation === 'pendingApprovals:resolve') return mockResolveApproval;
    if (mutation === 'sessionMessages:send') return mockSendSessionMessage;
    return vi.fn();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetMocks();
  mockResolveApproval.mockReset();
  mockSendSessionMessage.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSession(sessionId: string | null) {
  return renderHook(() => useSession(sessionId));
}

// Build a minimal Convex session record
function makeSessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    status: 'running',
    ...overrides,
  };
}

// Build a Convex pendingApproval record
function makeConvexApproval(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1',
    tool: 'Bash',
    input: JSON.stringify({ command: 'ls' }),
    resolved: false,
    approved: undefined,
    ...overrides,
  };
}

// Build a Convex event batch
function makeBatch(
  events: Array<{ data: string; timestamp?: number }>,
  batchIndex = 0,
) {
  return {
    batchIndex,
    events: events.map((e) => ({
      data: e.data,
      timestamp: e.timestamp ?? Date.now(),
    })),
  };
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
      expect(result.current.companionOnline).toBe(false);
      expect(result.current.messageQueued).toBe(false);
      expect(result.current.sdkSessionId).toBeUndefined();
    });

    it('exposes sdkSessionId from Convex session record', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return makeSessionRecord({
            sdkSessionId: 'sdk-abc-123',
            status: 'idle',
          });
        }
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.sdkSessionId).toBe('sdk-abc-123');
    });

    it('sdkSessionId is undefined when session record has no sdkSessionId yet', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.sdkSessionId).toBeUndefined();
    });

    it('sdkSessionId updates reactively when Convex session record changes', () => {
      let sessionRecord = makeSessionRecord({ status: 'running' });
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return sessionRecord;
        return [];
      });

      const { result, rerender } = renderSession('session-live');
      expect(result.current.sdkSessionId).toBeUndefined();

      sessionRecord = makeSessionRecord({
        sdkSessionId: 'sdk-newly-set',
        status: 'idle',
      });
      rerender();

      expect(result.current.sdkSessionId).toBe('sdk-newly-set');
    });
  });

  describe('events from Convex', () => {
    it('returns empty events when no batches exist', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessionEvents:getBySession') return [];
        return null;
      });
      const { result } = renderSession('session-1');
      expect(result.current.events).toEqual([]);
    });

    it('flattens a single batch into the events array', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessionEvents:getBySession') {
          return [
            makeBatch([
              {
                data: JSON.stringify({
                  type: 'text',
                  text: 'Hello from Claude',
                }),
              },
            ]),
          ];
        }
        if (query === 'sessions:get') return makeSessionRecord();
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.events).toHaveLength(1);
      expect(result.current.events[0]).toMatchObject({
        type: 'text',
        text: 'Hello from Claude',
      });
    });

    it('flattens multiple batches into a single ordered array', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessionEvents:getBySession') {
          return [
            makeBatch(
              [{ data: JSON.stringify({ type: 'text', text: 'First' }) }],
              0,
            ),
            makeBatch(
              [
                { data: JSON.stringify({ type: 'text', text: 'Second' }) },
                { data: JSON.stringify({ type: 'text', text: 'Third' }) },
              ],
              1,
            ),
          ];
        }
        if (query === 'sessions:get') return makeSessionRecord();
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.events).toHaveLength(3);
      expect(result.current.events[0]).toMatchObject({ text: 'First' });
      expect(result.current.events[1]).toMatchObject({ text: 'Second' });
      expect(result.current.events[2]).toMatchObject({ text: 'Third' });
    });

    it('parses event data as JSON (SDKMessage)', () => {
      const event = {
        type: 'assistant',
        message: { role: 'assistant', content: [] },
      };
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessionEvents:getBySession') {
          return [makeBatch([{ data: JSON.stringify(event) }])];
        }
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.events[0]).toEqual(event);
    });
  });

  describe('pending approvals from Convex', () => {
    it('returns empty approvals when none exist', () => {
      const { result } = renderSession('session-1');
      expect(result.current.pendingApprovals).toEqual([]);
    });

    it('maps Convex approval records to PendingApproval shape', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'pendingApprovals:getBySession') {
          return [
            makeConvexApproval({
              requestId: 'req-1',
              tool: 'Write',
              input: JSON.stringify({
                file_path: '/tmp/test.ts',
                content: 'hello',
              }),
              resolved: false,
            }),
          ];
        }
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.pendingApprovals).toHaveLength(1);

      const approval = result.current.pendingApprovals[0];
      expect(approval?.requestId).toBe('req-1');
      expect(approval?.tool).toBe('Write');
      expect(approval?.input).toEqual({
        file_path: '/tmp/test.ts',
        content: 'hello',
      });
      expect(approval?.resolved).toBeUndefined();
    });

    it('maps resolved approval with approved: true', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'pendingApprovals:getBySession') {
          return [
            makeConvexApproval({
              requestId: 'req-approved',
              resolved: true,
              approved: true,
            }),
          ];
        }
        return [];
      });

      const { result } = renderSession('session-1');
      const approval = result.current.pendingApprovals[0];
      expect(approval?.resolved).toEqual({ approved: true });
    });

    it('maps resolved approval with approved: false', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'pendingApprovals:getBySession') {
          return [
            makeConvexApproval({
              requestId: 'req-denied',
              resolved: true,
              approved: false,
            }),
          ];
        }
        return [];
      });

      const { result } = renderSession('session-1');
      const approval = result.current.pendingApprovals[0];
      expect(approval?.resolved).toEqual({ approved: false });
    });

    it('returns both unresolved and resolved approvals', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'pendingApprovals:getBySession') {
          return [
            makeConvexApproval({ requestId: 'req-pending', resolved: false }),
            makeConvexApproval({
              requestId: 'req-done',
              resolved: true,
              approved: true,
            }),
          ];
        }
        return [];
      });

      const { result } = renderSession('session-1');
      expect(result.current.pendingApprovals).toHaveLength(2);
    });
  });

  describe('status derivation', () => {
    it('returns null status when no session record exists', () => {
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBeNull();
    });

    it('maps queued → queued', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'queued' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('queued');
    });

    it('maps stopped → idle', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'stopped' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('idle');
    });

    it('maps running → running when no unresolved approvals', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('running');
    });

    it('maps running + unresolved approvals → waiting_input', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        if (query === 'pendingApprovals:getBySession') {
          return [makeConvexApproval({ resolved: false })];
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('waiting_input');
    });

    it('maps running + all approvals resolved → running (not waiting_input)', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        if (query === 'pendingApprovals:getBySession') {
          return [makeConvexApproval({ resolved: true, approved: true })];
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('running');
    });

    it('maps failed → failed', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'failed' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('failed');
    });

    it('maps idle → idle', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'idle' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('idle');
    });

    it('does not show waiting_input when session is idle with unresolved approvals', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'idle' });
        if (query === 'pendingApprovals:getBySession') {
          return [makeConvexApproval({ resolved: false })];
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('idle');
    });

    it('does not show waiting_input when session is failed with unresolved approvals', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'failed' });
        if (query === 'pendingApprovals:getBySession') {
          return [makeConvexApproval({ resolved: false })];
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.sessionStatus).toBe('failed');
    });
  });

  describe('companionOnline', () => {
    it('is false when no session record exists', () => {
      const { result } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(false);
    });

    it('is true when session status is queued', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'queued' });
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(true);
    });

    it('is true when lastHeartbeat is within 10s of now', () => {
      const recentHeartbeat = Date.now() - 5000; // 5s ago
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return makeSessionRecord({
            status: 'running',
            lastHeartbeat: recentHeartbeat,
          });
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(true);
    });

    it('is false when lastHeartbeat is stale (>10s old)', () => {
      const staleHeartbeat = Date.now() - 15000; // 15s ago
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return makeSessionRecord({
            status: 'running',
            lastHeartbeat: staleHeartbeat,
          });
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(false);
    });

    it('is false when no lastHeartbeat and status is not queued', () => {
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return makeSessionRecord({
            status: 'running',
            lastHeartbeat: undefined,
          });
        }
        return [];
      });
      const { result } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(false);
    });

    it('updates companionOnline reactively when heartbeat changes', () => {
      const staleHeartbeat = Date.now() - 15000;
      let heartbeat: number | undefined = staleHeartbeat;
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') {
          return makeSessionRecord({
            status: 'running',
            lastHeartbeat: heartbeat,
          });
        }
        return [];
      });

      const { result, rerender } = renderSession('session-1');
      expect(result.current.companionOnline).toBe(false);

      heartbeat = Date.now() - 1000; // fresh heartbeat
      rerender();
      expect(result.current.companionOnline).toBe(true);
    });
  });

  describe('approve()', () => {
    it('calls resolveApproval mutation with approved: true', () => {
      mockResolveApproval.mockResolvedValue(undefined);

      const { result } = renderSession('session-1');

      act(() => result.current.approve('req-1'));

      expect(mockResolveApproval).toHaveBeenCalledWith({
        sessionId: 'session-1',
        requestId: 'req-1',
        approved: true,
      });
    });

    it('is a no-op when sessionId is null', () => {
      const { result } = renderSession(null);
      act(() => result.current.approve('req-1'));
      expect(mockResolveApproval).not.toHaveBeenCalled();
    });
  });

  describe('deny()', () => {
    it('calls resolveApproval mutation with approved: false', () => {
      mockResolveApproval.mockResolvedValue(undefined);

      const { result } = renderSession('session-1');

      act(() => result.current.deny('req-2', 'Too dangerous'));

      expect(mockResolveApproval).toHaveBeenCalledWith({
        sessionId: 'session-1',
        requestId: 'req-2',
        approved: false,
        denyMessage: 'Too dangerous',
      });
    });

    it('passes denyMessage as undefined when no message is provided', () => {
      mockResolveApproval.mockResolvedValue(undefined);

      const { result } = renderSession('session-1');

      act(() => result.current.deny('req-3'));

      expect(mockResolveApproval).toHaveBeenCalledWith({
        sessionId: 'session-1',
        requestId: 'req-3',
        approved: false,
        denyMessage: undefined,
      });
    });

    it('is a no-op when sessionId is null', () => {
      const { result } = renderSession(null);
      act(() => result.current.deny('req-1'));
      expect(mockResolveApproval).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage()', () => {
    it('calls the sessionMessages.send mutation', async () => {
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

      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        return [];
      });

      const { result } = renderSession('session-running');
      expect(result.current.sessionStatus).toBe('running');

      await act(async () => {
        await result.current.sendMessage('session-running', 'follow-up');
      });

      expect(result.current.messageQueued).toBe(true);
    });

    it('does not set messageQueued when session is idle', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'idle' });
        return [];
      });

      const { result } = renderSession('session-idle');

      await act(async () => {
        await result.current.sendMessage('session-idle', 'resume message');
      });

      expect(result.current.messageQueued).toBe(false);
    });

    it('does not set messageQueued when session is waiting_input', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        if (query === 'pendingApprovals:getBySession') {
          return [makeConvexApproval({ resolved: false })];
        }
        return [];
      });

      const { result } = renderSession('session-waiting');
      expect(result.current.sessionStatus).toBe('waiting_input');

      await act(async () => {
        await result.current.sendMessage('session-waiting', 'message');
      });

      // waiting_input is not 'running', so messageQueued should not be set
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

  describe('messageQueued reset', () => {
    it('resets messageQueued when session transitions from running to idle', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      let status = 'running';
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return makeSessionRecord({ status });
        return [];
      });

      const { result, rerender } = renderSession('session-1');

      // Send a message while running
      await act(async () => {
        await result.current.sendMessage('session-1', 'hi');
      });
      expect(result.current.messageQueued).toBe(true);

      // Transition to idle
      status = 'idle';
      rerender();

      expect(result.current.messageQueued).toBe(false);
    });

    it('resets messageQueued when session transitions from running to failed', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      let status = 'running';
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get') return makeSessionRecord({ status });
        return [];
      });

      const { result, rerender } = renderSession('session-1');

      await act(async () => {
        await result.current.sendMessage('session-1', 'hi');
      });
      expect(result.current.messageQueued).toBe(true);

      status = 'failed';
      rerender();

      expect(result.current.messageQueued).toBe(false);
    });

    it('does NOT reset messageQueued when session transitions to waiting_input', async () => {
      mockSendSessionMessage.mockResolvedValue(undefined);

      let approvals: ReturnType<typeof makeConvexApproval>[] = [];
      mockedUseQuery.mockImplementation((query: unknown) => {
        if (query === 'sessions:get')
          return makeSessionRecord({ status: 'running' });
        if (query === 'pendingApprovals:getBySession') return approvals;
        return [];
      });

      const { result, rerender } = renderSession('session-1');

      await act(async () => {
        await result.current.sendMessage('session-1', 'hi');
      });
      expect(result.current.messageQueued).toBe(true);

      // New unresolved approval arrives → status becomes waiting_input
      approvals = [makeConvexApproval({ resolved: false })];
      rerender();

      // messageQueued should still be true (waiting_input is not a terminal state)
      expect(result.current.sessionStatus).toBe('waiting_input');
      expect(result.current.messageQueued).toBe(true);
    });
  });
});
