import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useHolophyteChat } from './useHolophyteChat';
import type {
  PendingApproval,
  ProjectCommand,
  SessionStatus,
} from './useSession';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantEvent(
  text: string,
  id = 'msg-1',
  uuid = 'u-1',
): SDKMessage {
  return {
    type: 'assistant',
    message: { id, content: [{ type: 'text', text }] },
    uuid,
  } as unknown as SDKMessage;
}

function makeUserEvent(text: string, uuid = 'u-u1'): SDKMessage {
  return {
    type: 'user',
    message: { content: text },
    uuid,
  } as unknown as SDKMessage;
}

function makeProps(overrides: {
  events?: SDKMessage[];
  sessionStatus?: SessionStatus | null;
  pendingApprovals?: PendingApproval[];
  projectCommands?: ProjectCommand[];
  messageQueued?: boolean;
}) {
  return {
    sessionId: 'sess-1',
    events: overrides.events ?? [],
    pendingApprovals: overrides.pendingApprovals ?? [],
    sessionStatus: overrides.sessionStatus ?? null,
    projectCommands: overrides.projectCommands ?? [],
    approve: vi.fn(),
    deny: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    handleStop: vi.fn().mockResolvedValue(undefined),
    messageQueued: overrides.messageQueued ?? false,
  };
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe('useHolophyteChat — status mapping', () => {
  it.each([
    [null, 'ready'],
    ['idle', 'ready'],
    ['queued', 'submitted'],
    ['running', 'streaming'],
    ['waiting_input', 'streaming'],
    ['failed', 'error'],
  ] as const)('maps sessionStatus %s → status %s', (sessionStatus, expected) => {
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ sessionStatus })),
    );
    expect(result.current.status).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

describe('useHolophyteChat — messages', () => {
  it('returns SDK messages transformed to UIMessage[]', () => {
    const events = [makeAssistantEvent('Hello')];
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ events })),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe('assistant');
  });
});

// ---------------------------------------------------------------------------
// Optimistic messages
// ---------------------------------------------------------------------------

describe('useHolophyteChat — optimistic messages', () => {
  it('sendMessage appends an optimistic user message and calls the prop', async () => {
    const props = makeProps({});
    const { result } = renderHook(() => useHolophyteChat(props));
    await act(async () => {
      await result.current.sendMessage('Hello');
    });
    expect(props.sendMessage).toHaveBeenCalledWith(
      'sess-1',
      'Hello',
      undefined,
    );
    const lastMsg = result.current.messages.at(-1);
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.parts[0]).toMatchObject({ type: 'text', text: 'Hello' });
  });

  it('clears optimistic messages when new events arrive', async () => {
    const initialEvents: SDKMessage[] = [];
    const props = makeProps({ events: initialEvents });
    const { result, rerender } = renderHook(
      (p: typeof props) => useHolophyteChat(p),
      { initialProps: props },
    );

    await act(async () => {
      await result.current.sendMessage('temp');
    });
    expect(result.current.messages).toHaveLength(1);

    // Simulate new event arriving
    const newProps = {
      ...props,
      events: [makeUserEvent('temp')],
    };
    rerender(newProps);

    // Optimistic messages should be cleared
    const optimisticMsgs = result.current.messages.filter((m) =>
      m.id.startsWith('optimistic-'),
    );
    expect(optimisticMsgs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Available commands
// ---------------------------------------------------------------------------

describe('useHolophyteChat — availableCommands', () => {
  it('returns projectCommands sorted by name', () => {
    const projectCommands: ProjectCommand[] = [
      { name: 'test', description: 'Run tests' },
      { name: 'build', description: 'Build project' },
    ];
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ projectCommands })),
    );
    expect(result.current.availableCommands.map((c) => c.name)).toEqual([
      'build',
      'test',
    ]);
  });

  it('merges skills from init event, deduplicating against projectCommands', () => {
    const initEvent = {
      type: 'system',
      subtype: 'init',
      skills: ['deploy', 'test'],
    } as unknown as SDKMessage;
    const projectCommands: ProjectCommand[] = [
      { name: 'test', description: 'Run tests' },
    ];
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ events: [initEvent], projectCommands })),
    );
    const names = result.current.availableCommands.map((c) => c.name);
    // 'test' from projectCommands + 'deploy' from skills (deduped)
    expect(names).toContain('deploy');
    expect(names.filter((n) => n === 'test')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Passthrough props
// ---------------------------------------------------------------------------

describe('useHolophyteChat — passthrough', () => {
  it('exposes approve and deny functions', () => {
    const props = makeProps({});
    const { result } = renderHook(() => useHolophyteChat(props));
    result.current.approve('req-1');
    result.current.deny('req-2', 'no thanks');
    expect(props.approve).toHaveBeenCalledWith('req-1');
    expect(props.deny).toHaveBeenCalledWith('req-2', 'no thanks');
  });

  it('exposes stop as handleStop', async () => {
    const props = makeProps({});
    const { result } = renderHook(() => useHolophyteChat(props));
    await act(async () => {
      await result.current.stop();
    });
    expect(props.handleStop).toHaveBeenCalled();
  });

  it('passes through messageQueued', () => {
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ messageQueued: true })),
    );
    expect(result.current.messageQueued).toBe(true);
  });

  it('passes through pendingApprovals', () => {
    const pendingApprovals: PendingApproval[] = [
      { requestId: 'r-1', tool: 'Bash', input: {} },
    ];
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ pendingApprovals })),
    );
    expect(result.current.pendingApprovals).toBe(pendingApprovals);
  });
});

// ---------------------------------------------------------------------------
// Interruption detection (GH #207)
// ---------------------------------------------------------------------------

describe('useHolophyteChat — isInterrupted', () => {
  function makeResultEvent(uuid = 'u-r'): SDKMessage {
    return {
      type: 'result',
      subtype: 'success',
      is_error: false,
      uuid,
    } as unknown as SDKMessage;
  }

  it('is false when session is running', () => {
    const { result } = renderHook(() =>
      useHolophyteChat(
        makeProps({
          events: [makeAssistantEvent('partial')],
          sessionStatus: 'running',
        }),
      ),
    );
    expect(result.current.isInterrupted).toBe(false);
  });

  it('is false when session ended with a terminal result event', () => {
    const { result } = renderHook(() =>
      useHolophyteChat(
        makeProps({
          events: [makeAssistantEvent('hello'), makeResultEvent()],
          sessionStatus: 'idle',
        }),
      ),
    );
    expect(result.current.isInterrupted).toBe(false);
  });

  it('is true when session is idle but last event is not a result', () => {
    // Simulates the user hitting Stop mid-response: the iterator is aborted
    // before the SDK emits the closing `result` event.
    const { result } = renderHook(() =>
      useHolophyteChat(
        makeProps({
          events: [makeUserEvent('hi'), makeAssistantEvent('partial…')],
          sessionStatus: 'idle',
        }),
      ),
    );
    expect(result.current.isInterrupted).toBe(true);
  });

  it('is false when there are no events at all', () => {
    const { result } = renderHook(() =>
      useHolophyteChat(makeProps({ events: [], sessionStatus: 'idle' })),
    );
    expect(result.current.isInterrupted).toBe(false);
  });

  it('is false when a metadata event lands after the terminal result', () => {
    // Repro for the concern flagged on #269 review: `prompt_suggestion` and
    // similar telemetry can arrive after the closing `result`. Detection must
    // scan back to the most recent turn marker rather than just eyeing the
    // very last event.
    const promptSuggestion = {
      type: 'prompt_suggestion',
      text: 'try the next thing',
    } as unknown as SDKMessage;
    const { result } = renderHook(() =>
      useHolophyteChat(
        makeProps({
          events: [
            makeUserEvent('hi'),
            makeAssistantEvent('hello'),
            makeResultEvent(),
            promptSuggestion,
          ],
          sessionStatus: 'idle',
        }),
      ),
    );
    expect(result.current.isInterrupted).toBe(false);
  });

  it('is false when session failed (error, not interruption)', () => {
    const { result } = renderHook(() =>
      useHolophyteChat(
        makeProps({
          events: [makeAssistantEvent('crashed mid-reply')],
          sessionStatus: 'failed',
        }),
      ),
    );
    expect(result.current.isInterrupted).toBe(false);
  });
});
