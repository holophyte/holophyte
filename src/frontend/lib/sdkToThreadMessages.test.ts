import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { PendingApproval } from '@/frontend/hooks/useSession';
import {
  extractPromptSuggestion,
  sdkToThreadMessages,
} from './sdkToThreadMessages';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Index into an array with a runtime bounds check (avoids non-null assertions). */
function at<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) throw new Error(`Index ${index} out of bounds`);
  return item;
}

// ---------------------------------------------------------------------------
// Test fixture helpers (ported from MessageStream.stories.tsx)
// ---------------------------------------------------------------------------

function assistantEvent(
  text: string,
  toolUses?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>,
): SDKMessage {
  const content: unknown[] = [];
  if (toolUses) {
    for (const tu of toolUses) {
      content.push({ type: 'tool_use', ...tu });
    }
  }
  if (text) {
    content.push({ type: 'text', text });
  }
  return {
    type: 'assistant',
    message: { content },
    uuid: `uuid-assistant-${Math.random().toString(36).slice(2)}`,
  } as unknown as SDKMessage;
}

function toolResultEvent(
  toolUseId: string,
  result: string,
  isError = false,
): SDKMessage {
  return {
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: result,
          is_error: isError,
        },
      ],
    },
    uuid: `uuid-toolresult-${Math.random().toString(36).slice(2)}`,
  } as unknown as SDKMessage;
}

function userTextEvent(text: string): SDKMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'text', text }] },
    uuid: `uuid-user-${Math.random().toString(36).slice(2)}`,
  } as unknown as SDKMessage;
}

function assistantEventWithUuid(
  uuid: string,
  text: string,
  toolUses?: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
  }>,
): SDKMessage {
  const content: unknown[] = [];
  if (toolUses) {
    for (const tu of toolUses) {
      content.push({ type: 'tool_use', ...tu });
    }
  }
  if (text) {
    content.push({ type: 'text', text });
  }
  return {
    type: 'assistant',
    message: { content },
    uuid,
  } as unknown as SDKMessage;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sdkToThreadMessages', () => {
  // --- Basic output shape ---

  it('returns an empty array for no events', () => {
    const result = sdkToThreadMessages([], false, []);
    expect(result).toEqual([]);
  });

  it('returns an empty array when events contain only ignored types', () => {
    const ignoredEvents = [
      { type: 'result', uuid: 'r1' },
      { type: 'system/init', uuid: 'r2' },
    ] as unknown as SDKMessage[];
    const result = sdkToThreadMessages(ignoredEvents, false, []);
    expect(result).toEqual([]);
  });

  // --- Text-only assistant response ---

  it('maps a text-only assistant event to a ThreadMessageLike with role assistant', () => {
    const event = assistantEventWithUuid('msg-1', 'Hello from Claude');
    const result = sdkToThreadMessages([event], false, []);
    expect(result).toHaveLength(1);
    const msg = at(result, 0);
    expect(msg.role).toBe('assistant');
    expect(msg.id).toBe('msg-1');
  });

  it('puts assistant text in a text content part', () => {
    const event = assistantEvent('Hello from Claude');
    const result = sdkToThreadMessages([event], false, []);
    const msg = at(result, 0);
    expect(Array.isArray(msg.content)).toBe(true);
    const textPart = (
      msg.content as unknown as Array<{ type: string; text?: string }>
    ).find((p) => p.type === 'text');
    expect(textPart).toBeDefined();
    expect(textPart?.text).toBe('Hello from Claude');
  });

  // --- Tool call + tool result pairing ---

  it('creates a tool-call content part for each tool_use block', () => {
    const event = assistantEvent('Reading file.', [
      { id: 'tu-1', name: 'Read', input: { file_path: 'src/server.ts' } },
    ]);
    const result = sdkToThreadMessages([event], false, []);
    const msg = at(result, 0);
    const parts = msg.content as unknown as Array<{
      type: string;
      toolCallId?: string;
      toolName?: string;
      args?: unknown;
    }>;
    const toolCallPart = parts.find((p) => p.type === 'tool-call');
    expect(toolCallPart).toBeDefined();
    expect(toolCallPart?.toolCallId).toBe('tu-1');
    expect(toolCallPart?.toolName).toBe('Read');
    expect(toolCallPart?.args).toEqual({ file_path: 'src/server.ts' });
  });

  it('associates tool result back to its tool-call part', () => {
    const event = assistantEvent('Reading file.', [
      { id: 'tu-1', name: 'Read', input: { file_path: 'src/server.ts' } },
    ]);
    const resultEvent = toolResultEvent('tu-1', 'file contents here');
    const result = sdkToThreadMessages([event, resultEvent], false, []);
    // Should still produce 1 assistant message (user tool-result events are not rendered as standalone messages)
    const assistantMsg = result.find((m) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    const parts = assistantMsg?.content as unknown as Array<{
      type: string;
      result?: string;
      isError?: boolean;
    }>;
    const toolCallPart = parts.find((p) => p.type === 'tool-call');
    expect(toolCallPart?.result).toBe('file contents here');
    expect(toolCallPart?.isError).toBeFalsy();
  });

  it('marks tool result as isError when is_error is true', () => {
    const event = assistantEvent('Running tests.', [
      { id: 'tu-2', name: 'Bash', input: { command: 'bun test' } },
    ]);
    const errEvent = toolResultEvent(
      'tu-2',
      "error: Cannot find module './missing'",
      true,
    );
    const result = sdkToThreadMessages([event, errEvent], false, []);
    const assistantMsg = result.find((m) => m.role === 'assistant');
    const parts = assistantMsg?.content as unknown as Array<{
      type: string;
      isError?: boolean;
    }>;
    const toolCallPart = parts.find((p) => p.type === 'tool-call');
    expect(toolCallPart?.isError).toBe(true);
  });

  // --- Interleaved text and tool calls in one assistant message ---

  it('includes both text and tool-call parts when an assistant message has both', () => {
    const event = assistantEvent('Let me read the server file first.', [
      { id: 'tu-3', name: 'Read', input: { file_path: 'src/server.ts' } },
    ]);
    const result = sdkToThreadMessages([event], false, []);
    const msg = at(result, 0);
    const parts = msg.content as unknown as Array<{ type: string }>;
    const types = parts.map((p) => p.type);
    expect(types).toContain('text');
    expect(types).toContain('tool-call');
  });

  it('handles multiple tool-call parts in a single assistant message', () => {
    const event = assistantEvent("I'll look at several files.", [
      { id: 'tu-4', name: 'Read', input: { file_path: 'src/server.ts' } },
      { id: 'tu-5', name: 'Glob', input: { pattern: '**/*.ts' } },
      { id: 'tu-6', name: 'Bash', input: { command: 'bun run test' } },
    ]);
    const result = sdkToThreadMessages([event], false, []);
    const msg = at(result, 0);
    const parts = msg.content as unknown as Array<{
      type: string;
      toolCallId?: string;
    }>;
    const toolCallParts = parts.filter((p) => p.type === 'tool-call');
    expect(toolCallParts).toHaveLength(3);
    const ids = toolCallParts.map((p) => p.toolCallId);
    expect(ids).toContain('tu-4');
    expect(ids).toContain('tu-5');
    expect(ids).toContain('tu-6');
  });

  // --- User text messages ---

  it('maps non-synthetic user text events to ThreadMessageLike with role user', () => {
    const event = userTextEvent('Please add TSDoc comments.');
    const result = sdkToThreadMessages([event], false, []);
    expect(result).toHaveLength(1);
    const msg = at(result, 0);
    expect(msg.role).toBe('user');
    const parts = msg.content as unknown as Array<{
      type: string;
      text?: string;
    }>;
    const textPart = parts.find((p) => p.type === 'text');
    expect(textPart?.text).toBe('Please add TSDoc comments.');
  });

  it('does not produce standalone user messages for tool_result events', () => {
    const assistEvt = assistantEvent('Running tests.', [
      { id: 'tu-7', name: 'Bash', input: { command: 'bun test' } },
    ]);
    const resultEvt = toolResultEvent('tu-7', 'All tests passed');
    const result = sdkToThreadMessages([assistEvt, resultEvt], false, []);
    // Only one message — the assistant one; no standalone user message for tool results
    expect(result.filter((m) => m.role === 'user')).toHaveLength(0);
    expect(result.filter((m) => m.role === 'assistant')).toHaveLength(1);
  });

  it('excludes synthetic user events', () => {
    const syntheticEvent = {
      type: 'user',
      message: { content: [{ type: 'text', text: 'system prompt' }] },
      uuid: 'uuid-synth',
      isSynthetic: true,
    } as unknown as SDKMessage;
    const result = sdkToThreadMessages([syntheticEvent], false, []);
    expect(result.filter((m) => m.role === 'user')).toHaveLength(0);
  });

  // --- isRunning flag — last message status ---

  it('sets last assistant message status to in_progress when isRunning is true', () => {
    const event = assistantEvent('Working on it...');
    const result = sdkToThreadMessages([event], true, []);
    const lastMsg = result[result.length - 1];
    expect(lastMsg?.status).toEqual(
      expect.objectContaining({ type: 'running' }),
    );
  });

  it('sets last assistant message status to complete when isRunning is false', () => {
    const event = assistantEvent('Done!');
    const result = sdkToThreadMessages([event], false, []);
    const lastMsg = result[result.length - 1];
    // complete status — may be { type: 'complete', reason: 'stop' } or similar
    expect(lastMsg?.status).toEqual(
      expect.objectContaining({ type: 'complete' }),
    );
  });

  it('only marks the last assistant message as in_progress, not earlier ones', () => {
    const event1 = assistantEvent('First message');
    const event2 = assistantEvent('Second message');
    const result = sdkToThreadMessages([event1, event2], true, []);
    const assistantMessages = result.filter((m) => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(2);
    // First message should be complete
    expect(assistantMessages[0]?.status).toEqual(
      expect.objectContaining({ type: 'complete' }),
    );
    // Last message should be in_progress
    expect(assistantMessages[1]?.status).toEqual(
      expect.objectContaining({ type: 'running' }),
    );
  });

  // --- Pending approvals — requires_action status on tool-call parts ---

  it('annotates tool-call parts with requires_action when approval is pending', () => {
    const event = assistantEvent('Running command.', [
      { id: 'tu-8', name: 'Bash', input: { command: 'rm -rf /tmp/foo' } },
    ]);
    const pendingApprovals: PendingApproval[] = [
      {
        requestId: 'tu-8',
        tool: 'Bash',
        input: { command: 'rm -rf /tmp/foo' },
        resolved: undefined,
      },
    ];
    const result = sdkToThreadMessages([event], false, pendingApprovals);
    const assistantMsg = result.find((m) => m.role === 'assistant');
    const parts = assistantMsg?.content as unknown as Array<{
      type: string;
      toolCallId?: string;
      status?: unknown;
    }>;
    const toolCallPart = parts.find(
      (p) => p.type === 'tool-call' && p.toolCallId === 'tu-8',
    );
    expect(toolCallPart).toBeDefined();
    // The tool-call part should have a requires_action status
    expect(toolCallPart?.status).toEqual(
      expect.objectContaining({ type: 'requires-action' }),
    );
  });

  it('does not annotate tool-call parts when approval is resolved', () => {
    const event = assistantEvent('Running command.', [
      { id: 'tu-9', name: 'Bash', input: { command: 'ls' } },
    ]);
    const resolvedApprovals: PendingApproval[] = [
      {
        requestId: 'tu-9',
        tool: 'Bash',
        input: { command: 'ls' },
        resolved: { approved: true },
      },
    ];
    const result = sdkToThreadMessages([event], false, resolvedApprovals);
    const assistantMsg = result.find((m) => m.role === 'assistant');
    const parts = assistantMsg?.content as unknown as Array<{
      type: string;
      toolCallId?: string;
      status?: unknown;
    }>;
    const toolCallPart = parts.find(
      (p) => p.type === 'tool-call' && p.toolCallId === 'tu-9',
    );
    expect(toolCallPart).toBeDefined();
    // Should NOT have requires-action status when resolved
    if (toolCallPart?.status) {
      expect((toolCallPart.status as { type: string }).type).not.toBe(
        'requires-action',
      );
    }
  });

  // --- Stable IDs from uuid ---

  it('uses SDKMessage uuid as the ThreadMessageLike id', () => {
    const event = assistantEventWithUuid('stable-uuid-123', 'Hello');
    const result = sdkToThreadMessages([event], false, []);
    expect(result[0]?.id).toBe('stable-uuid-123');
  });

  // --- Ignored event types ---

  it('ignores type=result events', () => {
    const events = [
      { type: 'result', uuid: 'r1', result: 'some result' },
    ] as unknown as SDKMessage[];
    const result = sdkToThreadMessages(events, false, []);
    expect(result).toHaveLength(0);
  });

  it('ignores type=system/init events', () => {
    const events = [
      { type: 'system/init', uuid: 'si1', session_id: 'sess-abc' },
    ] as unknown as SDKMessage[];
    const result = sdkToThreadMessages(events, false, []);
    expect(result).toHaveLength(0);
  });

  it('ignores unknown event types', () => {
    const events = [
      { type: 'unknown_future_type', uuid: 'unk1' },
    ] as unknown as SDKMessage[];
    const result = sdkToThreadMessages(events, false, []);
    expect(result).toHaveLength(0);
  });

  // --- Mixed conversation ---

  it('handles a full conversation with user messages between assistant turns', () => {
    const events = [
      assistantEvent(
        "I've finished reading the codebase. What would you like me to do next?",
      ),
      userTextEvent('Please add TSDoc comments to all exported functions.'),
      assistantEvent("I'll add TSDoc comments to all exported functions now."),
    ];
    const result = sdkToThreadMessages(events, false, []);
    expect(result).toHaveLength(3);
    expect(result[0]?.role).toBe('assistant');
    expect(result[1]?.role).toBe('user');
    expect(result[2]?.role).toBe('assistant');
  });

  it('handles assistant messages with only tool uses and no text', () => {
    const event = assistantEvent('', [
      { id: 'tu-10', name: 'Read', input: { file_path: 'README.md' } },
    ]);
    const result = sdkToThreadMessages([event], false, []);
    expect(result).toHaveLength(1);
    const msg = at(result, 0);
    const parts = msg.content as unknown as Array<{ type: string }>;
    expect(parts.some((p) => p.type === 'tool-call')).toBe(true);
    expect(parts.some((p) => p.type === 'text')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// extractPromptSuggestion
// ---------------------------------------------------------------------------

function promptSuggestionEvent(suggestion: string): SDKMessage {
  return { type: 'prompt_suggestion', suggestion } as unknown as SDKMessage;
}

describe('extractPromptSuggestion', () => {
  it('returns suggestion text when the last event is a prompt_suggestion', () => {
    const events = [userTextEvent('hi'), promptSuggestionEvent('What next?')];
    expect(extractPromptSuggestion(events)).toBe('What next?');
  });

  it('returns null when a user event comes after the last prompt_suggestion', () => {
    const events = [promptSuggestionEvent('Try this'), userTextEvent('ok')];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('returns null when an assistant event comes after the last prompt_suggestion', () => {
    const events = [promptSuggestionEvent('Try this'), assistantEvent('Sure!')];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('returns null for an empty event array', () => {
    expect(extractPromptSuggestion([])).toBeNull();
  });

  it('returns null when no prompt_suggestion events exist', () => {
    const events = [userTextEvent('hello'), assistantEvent('Hello back!')];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('returns the latest suggestion when multiple prompt_suggestion events appear in one turn', () => {
    const events = [
      userTextEvent('go'),
      promptSuggestionEvent('first'),
      promptSuggestionEvent('second'),
    ];
    // Reverse scan encounters 'second' first
    expect(extractPromptSuggestion(events)).toBe('second');
  });

  it('ignores empty suggestion strings and returns an earlier non-empty one', () => {
    const events = [
      userTextEvent('go'),
      promptSuggestionEvent('fallback'),
      promptSuggestionEvent('   '),
    ];
    expect(extractPromptSuggestion(events)).toBe('fallback');
  });

  it('returns null for a whitespace-only suggestion with no other suggestions in the turn', () => {
    const events = [userTextEvent('go'), promptSuggestionEvent('   ')];
    expect(extractPromptSuggestion(events)).toBeNull();
  });

  it('returns suggestion that appears after a user turn but before the next assistant event', () => {
    const events = [
      assistantEvent('I can help.'),
      userTextEvent('Continue?'),
      promptSuggestionEvent('Next step'),
    ];
    expect(extractPromptSuggestion(events)).toBe('Next step');
  });
});
