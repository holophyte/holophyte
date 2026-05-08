import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { PendingApproval } from '@/frontend/hooks/useSession';
import { extractPromptSuggestion, sdkToUIMessages } from './sdkToUIMessages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAssistantEvent(
  content: unknown[],
  id = 'msg-1',
  uuid = 'uuid-1',
): SDKMessage {
  return {
    type: 'assistant',
    message: { id, content },
    uuid,
  } as unknown as SDKMessage;
}

function makeUserEvent(
  content: string | unknown[],
  uuid = 'uuid-u1',
  isSynthetic = false,
): SDKMessage {
  return {
    type: 'user',
    message: { content },
    uuid,
    isSynthetic,
  } as unknown as SDKMessage;
}

function makeToolResultEvent(
  toolUseId: string,
  result: string,
  isError = false,
): SDKMessage {
  return makeUserEvent([
    {
      type: 'tool_result',
      tool_use_id: toolUseId,
      content: result,
      is_error: isError,
    },
  ]);
}

const noPending: PendingApproval[] = [];

// ---------------------------------------------------------------------------
// Text messages
// ---------------------------------------------------------------------------

describe('sdkToUIMessages — text-only assistant message', () => {
  it('produces a UIMessage with a text part', () => {
    const events = [
      makeAssistantEvent([{ type: 'text', text: 'Hello world' }]),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('assistant');
    expect(result[0]?.parts).toHaveLength(1);
    expect(result[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'Hello world',
    });
  });

  it('sets text state to "streaming" when isRunning is true for the last message', () => {
    const events = [
      makeAssistantEvent([{ type: 'text', text: 'Streaming...' }]),
    ];
    const result = sdkToUIMessages(events, true, noPending);
    expect(result[0]?.parts[0]).toMatchObject({
      type: 'text',
      state: 'streaming',
    });
  });

  it('sets text state to "done" when isRunning is false', () => {
    const events = [makeAssistantEvent([{ type: 'text', text: 'Done.' }])];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result[0]?.parts[0]).toMatchObject({ type: 'text', state: 'done' });
  });

  it('skips text blocks with empty content', () => {
    const events = [makeAssistantEvent([{ type: 'text', text: '' }])];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tool-use messages
// ---------------------------------------------------------------------------

describe('sdkToUIMessages — tool-use parts', () => {
  it('produces a dynamic-tool part with output-available when a result exists', () => {
    const events = [
      makeAssistantEvent([
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Bash',
          input: { command: 'ls' },
        },
      ]),
      makeToolResultEvent('tool-1', 'file1.txt'),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Bash',
      toolCallId: 'tool-1',
      state: 'output-available',
      input: { command: 'ls' },
      output: 'file1.txt',
    });
  });

  it('produces output-error state when is_error is true', () => {
    const events = [
      makeAssistantEvent([
        { type: 'tool_use', id: 'tool-2', name: 'Edit', input: {} },
      ]),
      makeToolResultEvent('tool-2', 'Permission denied', true),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-error',
      errorText: 'Permission denied',
    });
  });

  it('produces input-available state when no result exists yet', () => {
    const events = [
      makeAssistantEvent([
        {
          type: 'tool_use',
          id: 'tool-3',
          name: 'Write',
          input: { path: '/a' },
        },
      ]),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Write',
      state: 'input-available',
    });
  });

  it('produces approval-requested state for pending (unresolved) approvals', () => {
    const pending: PendingApproval[] = [
      { requestId: 'tool-4', tool: 'Bash', input: {}, resolved: undefined },
    ];
    const events = [
      makeAssistantEvent([
        {
          type: 'tool_use',
          id: 'tool-4',
          name: 'Bash',
          input: { command: 'rm -rf' },
        },
      ]),
    ];
    const result = sdkToUIMessages(events, false, pending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      state: 'approval-requested',
      approval: { id: 'tool-4' },
    });
  });

  it('uses output-available (not approval-requested) for resolved approvals', () => {
    const pending: PendingApproval[] = [
      {
        requestId: 'tool-5',
        tool: 'Bash',
        input: {},
        resolved: { approved: true },
      },
    ];
    const events = [
      makeAssistantEvent([
        { type: 'tool_use', id: 'tool-5', name: 'Bash', input: {} },
      ]),
      makeToolResultEvent('tool-5', 'ok'),
    ];
    const result = sdkToUIMessages(events, false, pending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part.state).toBe('output-available');
  });

  it('produces approval-responded state for approved-but-no-result-yet tool', () => {
    const pending: PendingApproval[] = [
      {
        requestId: 'tool-6',
        tool: 'Bash',
        input: { command: 'ls' },
        resolved: { approved: true },
      },
    ];
    const events = [
      makeAssistantEvent([
        {
          type: 'tool_use',
          id: 'tool-6',
          name: 'Bash',
          input: { command: 'ls' },
        },
      ]),
      // No tool_result event yet
    ];
    const result = sdkToUIMessages(events, false, pending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Bash',
      toolCallId: 'tool-6',
      state: 'approval-responded',
      approval: { id: 'tool-6', approved: true },
    });
  });

  it('produces output-denied state for denied-but-no-result-yet tool', () => {
    const pending: PendingApproval[] = [
      {
        requestId: 'tool-7',
        tool: 'Bash',
        input: { command: 'rm -rf /' },
        resolved: { approved: false },
      },
    ];
    const events = [
      makeAssistantEvent([
        {
          type: 'tool_use',
          id: 'tool-7',
          name: 'Bash',
          input: { command: 'rm -rf /' },
        },
      ]),
      // No tool_result event yet
    ];
    const result = sdkToUIMessages(events, false, pending);
    const part = result[0]?.parts[0] as Record<string, unknown>;
    expect(part).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'Bash',
      toolCallId: 'tool-7',
      state: 'output-denied',
      approval: { id: 'tool-7', approved: false },
    });
  });
});

// ---------------------------------------------------------------------------
// User messages
// ---------------------------------------------------------------------------

describe('sdkToUIMessages — user messages', () => {
  it('extracts text from a string content user message', () => {
    const events = [makeUserEvent('Say hello')];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
    expect(result[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'Say hello',
    });
  });

  it('extracts text blocks from array content, skipping tool_result blocks', () => {
    const events = [
      makeUserEvent([
        { type: 'text', text: 'User text' },
        { type: 'tool_result', tool_use_id: 'x', content: 'result' },
      ]),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.parts).toHaveLength(1);
    expect(result[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'User text',
    });
  });

  it('skips synthetic user events', () => {
    const events = [makeUserEvent('synthetic', 'uuid-s', true)];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(0);
  });

  it('skips user events that produce no text', () => {
    const events = [
      makeUserEvent([{ type: 'tool_result', tool_use_id: 'x', content: 'r' }]),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Progressive snapshot deduplication
// ---------------------------------------------------------------------------

describe('sdkToUIMessages — deduplication', () => {
  it('uses the last snapshot for a given message id', () => {
    const snapshot1 = makeAssistantEvent(
      [{ type: 'text', text: 'partial' }],
      'msg-A',
      'u1',
    );
    const snapshot2 = makeAssistantEvent(
      [{ type: 'text', text: 'full response' }],
      'msg-A',
      'u1',
    );
    const result = sdkToUIMessages([snapshot1, snapshot2], false, noPending);
    // Only one message emitted
    expect(result).toHaveLength(1);
    // Should use the second snapshot's content
    expect(result[0]?.parts[0]).toMatchObject({
      type: 'text',
      text: 'full response',
    });
  });

  it('emits separate messages for different stable IDs', () => {
    const events = [
      makeAssistantEvent([{ type: 'text', text: 'First' }], 'msg-1', 'u1'),
      makeAssistantEvent([{ type: 'text', text: 'Second' }], 'msg-2', 'u2'),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Mixed message stream
// ---------------------------------------------------------------------------

describe('sdkToUIMessages — mixed stream', () => {
  it('interleaves user and assistant messages in order', () => {
    const events = [
      makeUserEvent('Hello', 'u-1'),
      makeAssistantEvent([{ type: 'text', text: 'Hi!' }], 'msg-1', 'a-1'),
      makeUserEvent('Follow-up', 'u-2'),
      makeAssistantEvent([{ type: 'text', text: 'Sure.' }], 'msg-2', 'a-2'),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(4);
    expect(result[0]?.role).toBe('user');
    expect(result[1]?.role).toBe('assistant');
    expect(result[2]?.role).toBe('user');
    expect(result[3]?.role).toBe('assistant');
  });
});

// ---------------------------------------------------------------------------
// extractPromptSuggestion
// ---------------------------------------------------------------------------

describe('extractPromptSuggestion', () => {
  it('returns null for an empty event stream', () => {
    expect(extractPromptSuggestion([])).toBeNull();
  });

  it('returns the suggestion from the last prompt_suggestion event', () => {
    const events = [
      { type: 'prompt_suggestion', suggestion: 'Try this' },
    ] as unknown as SDKMessage[];
    expect(extractPromptSuggestion(events)).toBe('Try this');
  });

  it('returns null if a user/assistant event follows the suggestion', () => {
    const events: SDKMessage[] = [
      {
        type: 'prompt_suggestion',
        suggestion: 'Try this',
      } as unknown as SDKMessage,
      makeUserEvent('Hello'),
    ];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('returns null for empty/whitespace-only suggestions', () => {
    const events = [
      { type: 'prompt_suggestion', suggestion: '   ' },
    ] as unknown as SDKMessage[];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('trims the suggestion', () => {
    const events = [
      { type: 'prompt_suggestion', suggestion: '  do something  ' },
    ] as unknown as SDKMessage[];
    expect(extractPromptSuggestion(events)).toBe('do something');
  });
});

// ---------------------------------------------------------------------------
// Codex events
// ---------------------------------------------------------------------------

function makeCodexEvent(method: string, params: unknown): SDKMessage {
  return {
    type: `codex.${method}`,
    data: JSON.stringify({ method, params }),
  } as unknown as SDKMessage;
}

describe('sdkToUIMessages — Codex agent message', () => {
  it('builds a streaming bubble from agentMessage deltas while turn is active', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('turn/started', { threadId: 't', turn: { id: 'turn-1' } }),
      makeCodexEvent('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Hello',
      }),
      makeCodexEvent('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: ' world',
      }),
    ];
    const result = sdkToUIMessages(events, true, noPending);
    expect(result).toHaveLength(1);
    const part = result[0]?.parts[0] as {
      type: string;
      text: string;
      state?: string;
    };
    expect(part.type).toBe('text');
    expect(part.text).toBe('Hello world');
    expect(part.state).toBe('streaming');
  });

  it('marks the bubble as done after item/completed agentMessage', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('turn/started', { threadId: 't', turn: { id: 'turn-1' } }),
      makeCodexEvent('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Hi',
      }),
      makeCodexEvent('item/completed', {
        threadId: 't',
        turnId: 'turn-1',
        item: { type: 'agentMessage', id: 'msg-1', text: 'Hi there' },
      }),
    ];
    const result = sdkToUIMessages(events, true, noPending);
    const part = result[0]?.parts[0] as {
      type: string;
      text: string;
      state?: string;
    };
    expect(part.text).toBe('Hi there');
    expect(part.state).toBe('done');
  });

  it('marks deltas as done after turn/completed', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('turn/started', { threadId: 't', turn: { id: 'turn-1' } }),
      makeCodexEvent('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Done',
      }),
      makeCodexEvent('turn/completed', {
        threadId: 't',
        turn: { id: 'turn-1', status: 'completed' },
      }),
    ];
    const result = sdkToUIMessages(events, true, noPending);
    const part = result[0]?.parts[0] as { state?: string };
    expect(part.state).toBe('done');
  });

  it('marks deltas as done when session is no longer running', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('turn/started', { threadId: 't', turn: { id: 'turn-1' } }),
      makeCodexEvent('item/agentMessage/delta', {
        threadId: 't',
        turnId: 'turn-1',
        itemId: 'msg-1',
        delta: 'Hi',
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { state?: string };
    expect(part.state).toBe('done');
  });
});

describe('sdkToUIMessages — Codex user messages', () => {
  it('renders a placeholder for image-only userMessage so the turn stays visible', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'userMessage',
          id: 'um-img',
          content: [
            { type: 'image', url: 'https://example.com/x.png' },
            { type: 'localImage', path: '/tmp/x.png' },
          ],
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
    const part = result[0]?.parts[0] as { text: string };
    expect(part.text).toMatch(/image|localImage/);
  });

  it('renders a userMessage item as a role=user UIMessage', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'userMessage',
          id: 'um-1',
          content: [{ type: 'text', text: 'hello codex' }],
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.role).toBe('user');
    const part = result[0]?.parts[0] as { type: string; text: string };
    expect(part.text).toBe('hello codex');
  });
});

describe('sdkToUIMessages — Codex tool items', () => {
  it('renders a commandExecution as a Bash dynamic-tool with output', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-1',
          command: 'ls',
          cwd: '/tmp',
          status: 'completed',
          aggregatedOutput: 'file.txt\n',
          exitCode: 0,
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    const part = result[0]?.parts[0] as {
      type: string;
      toolName: string;
      state: string;
      input: { command: string };
      output?: unknown;
    };
    expect(part.type).toBe('dynamic-tool');
    expect(part.toolName).toBe('Bash');
    expect(part.state).toBe('output-available');
    expect(part.input.command).toBe('ls');
    expect(part.output).toBe('file.txt\n');
  });

  it('renders a failed commandExecution as output-error', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-2',
          command: 'false',
          cwd: '/tmp',
          status: 'failed',
          aggregatedOutput: 'failed',
          exitCode: 1,
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { state: string; errorText?: string };
    expect(part.state).toBe('output-error');
    expect(part.errorText).toBe('failed');
  });

  it('renders a fileChange as an Edit dynamic-tool', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'fileChange',
          id: 'fc-1',
          status: 'completed',
          changes: [
            { path: 'a.ts', kind: 'update', diff: '...' },
            { path: 'b.ts', kind: 'add', diff: '...' },
          ],
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { toolName: string; output?: unknown };
    expect(part.toolName).toBe('Edit');
    expect(part.output).toBe('2 file changes');
  });

  it('renders an mcpToolCall with namespaced tool name', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'mcpToolCall',
          id: 'mcp-1',
          server: 'github',
          tool: 'list_prs',
          status: 'completed',
          arguments: { owner: 'foo' },
          result: { ok: true },
          error: null,
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { toolName: string; state: string };
    expect(part.toolName).toBe('mcp__github__list_prs');
    expect(part.state).toBe('output-available');
  });

  it('shows an in-progress Bash card on item/started before completion', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/started', {
        item: {
          type: 'commandExecution',
          id: 'cmd-pending',
          command: 'sleep 30',
          cwd: '/tmp',
          status: 'inProgress',
        },
      }),
    ];
    const result = sdkToUIMessages(events, true, noPending);
    expect(result).toHaveLength(1);
    const part = result[0]?.parts[0] as { state: string; toolName: string };
    expect(part.toolName).toBe('Bash');
    expect(part.state).toBe('input-available');
  });

  it('updates the same message when item/started is followed by item/completed', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/started', {
        item: {
          type: 'commandExecution',
          id: 'cmd-x',
          command: 'echo hi',
          cwd: '/tmp',
          status: 'inProgress',
        },
      }),
      makeCodexEvent('item/completed', {
        item: {
          type: 'commandExecution',
          id: 'cmd-x',
          command: 'echo hi',
          cwd: '/tmp',
          status: 'completed',
          aggregatedOutput: 'hi\n',
          exitCode: 0,
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('codex-cmd-x');
    const part = result[0]?.parts[0] as { state: string; output?: unknown };
    expect(part.state).toBe('output-available');
    expect(part.output).toBe('hi\n');
  });

  it('renders a webSearch item', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: { type: 'webSearch', id: 'ws-1', query: 'how to bun' },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as {
      toolName: string;
      input: { query: string };
      state: string;
    };
    expect(part.toolName).toBe('WebSearch');
    expect(part.input.query).toBe('how to bun');
    expect(part.state).toBe('output-available');
  });

  it('renders a webSearch item/started as in-progress (query is in started payload too)', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/started', {
        item: { type: 'webSearch', id: 'ws-1', query: 'how to bun' },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { state: string };
    expect(part.state).toBe('input-available');
  });

  it('renders a reasoning item as a reasoning part', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('item/completed', {
        item: {
          type: 'reasoning',
          id: 'r-1',
          summary: ['Looking at...'],
          content: ['detailed thought'],
        },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    const part = result[0]?.parts[0] as { type: string; text: string };
    expect(part.type).toBe('reasoning');
    expect(part.text).toContain('Looking at');
    expect(part.text).toContain('detailed thought');
  });

  it('silently skips unknown codex methods', () => {
    const events: SDKMessage[] = [
      makeCodexEvent('thread/tokenUsage/updated', {
        threadId: 't',
        tokenUsage: { total: { totalTokens: 10 } },
      }),
      makeCodexEvent('account/rateLimits/updated', {}),
      makeCodexEvent('mcpServer/startupStatus/updated', {}),
      makeCodexEvent('some/future/method', { foo: 'bar' }),
    ];
    expect(() => sdkToUIMessages(events, false, noPending)).not.toThrow();
    expect(sdkToUIMessages(events, false, noPending)).toHaveLength(0);
  });

  it('does not crash on malformed codex event data', () => {
    const events = [
      { type: 'codex.item/completed', data: 'not json' },
    ] as unknown as SDKMessage[];
    expect(() => sdkToUIMessages(events, false, noPending)).not.toThrow();
  });

  it('mixes Codex and Claude events without interfering', () => {
    const events: SDKMessage[] = [
      makeAssistantEvent([{ type: 'text', text: 'Claude here' }], 'claude-1'),
      makeCodexEvent('turn/started', { threadId: 't', turn: { id: 'turn-1' } }),
      makeCodexEvent('item/completed', {
        item: { type: 'agentMessage', id: 'codex-msg', text: 'Codex here' },
      }),
    ];
    const result = sdkToUIMessages(events, false, noPending);
    expect(result).toHaveLength(2);
    const claudePart = result[0]?.parts[0] as { text: string };
    const codexPart = result[1]?.parts[0] as { text: string };
    expect(claudePart.text).toBe('Claude here');
    expect(codexPart.text).toBe('Codex here');
  });
});
