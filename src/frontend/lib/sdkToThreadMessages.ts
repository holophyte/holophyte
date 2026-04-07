/**
 * Backward-compatibility adapter for `sdkToThreadMessages`.
 *
 * The canonical implementation now lives in `sdkToUIMessages.ts` and produces
 * `UIMessage[]` (from the `ai` package). This module re-exports
 * `extractPromptSuggestion` and converts `UIMessage[]` back to
 * `ThreadMessageLike[]` so that `SessionRuntimeProvider` keeps working without
 * modification until it is removed in a future PR.
 */
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { UIMessage } from 'ai';
import type { PendingApproval } from '@/frontend/hooks/useSession';
import { sdkToUIMessages } from './sdkToUIMessages';

export { extractPromptSuggestion } from './sdkToUIMessages';

type ContentPart = Extract<
  ThreadMessageLike['content'],
  readonly unknown[]
>[number];

/** Convert a `UIMessage` into a `ThreadMessageLike` for assistant-ui. */
function uiMessageToThreadMessage(
  msg: UIMessage,
  isRunning: boolean,
  isLast: boolean,
): ThreadMessageLike | null {
  if (msg.role === 'user') {
    const textParts = msg.parts.filter((p) => p.type === 'text');
    if (textParts.length === 0) return null;
    const text = textParts.map((p) => (p as { text: string }).text).join('');
    if (!text) return null;
    return {
      id: msg.id,
      role: 'user',
      content: [{ type: 'text', text }],
    };
  }

  if (msg.role === 'assistant') {
    const parts: ContentPart[] = [];

    for (const part of msg.parts) {
      if (part.type === 'text') {
        const text = (part as { text: string }).text;
        if (text) parts.push({ type: 'text', text });
      } else if (part.type === 'dynamic-tool') {
        const p = part as {
          toolName: string;
          toolCallId: string;
          state: string;
          input: unknown;
          output?: unknown;
          errorText?: string;
          approval?: { id: string };
        };

        const isUnresolved = p.state === 'approval-requested';
        const hasResult =
          p.state === 'output-available' || p.state === 'output-error';
        const isError = p.state === 'output-error';

        parts.push({
          type: 'tool-call',
          toolCallId: p.toolCallId,
          toolName: p.toolName,
          // biome-ignore lint/suspicious/noExplicitAny: SDK input is untyped; assistant-ui expects ReadonlyJSONObject
          args: p.input as any,
          result: hasResult ? String(p.output ?? p.errorText ?? '') : undefined,
          isError: isError || undefined,
          ...(isUnresolved
            ? {
                status: {
                  type: 'requires-action' as const,
                  reason: 'interrupt' as const,
                },
              }
            : undefined),
        });
      }
    }

    if (parts.length === 0) return null;

    const status: ThreadMessageLike['status'] =
      isRunning && isLast
        ? { type: 'running' }
        : { type: 'complete', reason: 'stop' };

    return {
      id: msg.id,
      role: 'assistant',
      content: parts as ThreadMessageLike['content'],
      status,
    };
  }

  return null;
}

/**
 * Transforms an array of SDK events into `ThreadMessageLike[]` for use with
 * `@assistant-ui/react`'s external store runtime.
 *
 * @param events - Accumulated SDK events from `useSession`.
 * @param isRunning - When `true`, the last assistant message status is set to
 *   `'running'`; otherwise `'complete'`.
 * @param pendingApprovals - Unresolved approval requests are used to annotate
 *   tool-call parts with a `requires-action` status.
 */
export function sdkToThreadMessages(
  events: SDKMessage[],
  isRunning: boolean,
  pendingApprovals: PendingApproval[],
): ThreadMessageLike[] {
  const uiMessages = sdkToUIMessages(events, isRunning, pendingApprovals);
  const assistantMessages = uiMessages.filter((m) => m.role === 'assistant');
  const lastAssistantMsg = assistantMessages.at(-1);

  const result: ThreadMessageLike[] = [];
  for (const msg of uiMessages) {
    const isLast = msg === lastAssistantMsg;
    const converted = uiMessageToThreadMessage(msg, isRunning, isLast);
    if (converted) result.push(converted);
  }
  return result;
}
