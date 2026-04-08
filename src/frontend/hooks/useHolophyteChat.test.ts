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

  it('returns the sessionId as id', () => {
    const { result } = renderHook(() => useHolophyteChat(makeProps({})));
    expect(result.current.id).toBe('sess-1');
  });
});

// ---------------------------------------------------------------------------
// Optimistic messages
// ---------------------------------------------------------------------------

describe('useHolophyteChat — optimistic messages', () => {
  it('addOptimisticMessage appends a user UIMessage immediately', () => {
    const { result } = renderHook(() => useHolophyteChat(makeProps({})));
    act(() => {
      result.current.addOptimisticMessage('Optimistic text');
    });
    const lastMsg = result.current.messages.at(-1);
    expect(lastMsg?.role).toBe('user');
    expect(lastMsg?.parts[0]).toMatchObject({
      type: 'text',
      text: 'Optimistic text',
    });
  });

  it('sendMessage adds an optimistic message and calls sendMessage prop', async () => {
    const props = makeProps({});
    const { result } = renderHook(() => useHolophyteChat(props));
    await act(async () => {
      await result.current.sendMessage('Hello');
    });
    expect(props.sendMessage).toHaveBeenCalledWith('sess-1', 'Hello');
    const lastMsg = result.current.messages.at(-1);
    expect(lastMsg?.role).toBe('user');
  });

  it('clears optimistic messages when new events arrive', () => {
    const initialEvents: SDKMessage[] = [];
    const props = makeProps({ events: initialEvents });
    const { result, rerender } = renderHook(
      (p: typeof props) => useHolophyteChat(p),
      { initialProps: props },
    );

    act(() => {
      result.current.addOptimisticMessage('temp');
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
