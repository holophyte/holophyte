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
