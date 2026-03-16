import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { PendingApproval } from '@/frontend/hooks/useSession';

type ContentPart = Extract<
  ThreadMessageLike['content'],
  readonly unknown[]
>[number];

export interface SdkConversionResult {
  messages: ThreadMessageLike[];
  /** Prompt suggestions emitted by the SDK (most recent last). */
  suggestions: string[];
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
): SdkConversionResult {
  // Set of requestIds that still need user action
  const unresolvedIds = new Set(
    pendingApprovals.filter((a) => !a.resolved).map((a) => a.requestId),
  );

  // First pass: collect tool results keyed by tool_use_id
  const toolResults = new Map<string, { result: string; isError: boolean }>();

  for (const event of events) {
    if (event.type === 'user') {
      const msg = event.message as { content?: unknown[] };
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'tool_result') {
            const toolUseId = String(b.tool_use_id ?? '');
            const content = b.content;
            let resultText = '';
            if (typeof content === 'string') {
              resultText = content;
            } else if (Array.isArray(content)) {
              resultText = (content as Array<Record<string, unknown>>)
                .filter((c) => c.type === 'text')
                .map((c) => String(c.text ?? ''))
                .join('');
            }
            toolResults.set(toolUseId, {
              result: resultText,
              isError: b.is_error === true,
            });
          }
        }
      }
    }
  }

  const messages: ThreadMessageLike[] = [];
  // Only keep the suggestion from the latest turn — clear when a new user message appears
  let latestSuggestion: string | undefined;

  // Second pass: build ThreadMessageLike entries
  for (const event of events) {
    if (event.type === 'assistant') {
      const msg = event.message as { content?: unknown[] };
      const content = Array.isArray(msg.content) ? msg.content : [];
      const uuid = (event as { uuid?: string }).uuid;

      const parts: ContentPart[] = [];

      for (const block of content) {
        const b = block as Record<string, unknown>;

        if (b.type === 'text') {
          const text = String(b.text ?? '');
          if (text) {
            parts.push({ type: 'text', text });
          }
        } else if (b.type === 'tool_use') {
          const toolCallId = String(b.id ?? '');
          const toolName = String(b.name ?? '');
          // biome-ignore lint/suspicious/noExplicitAny: SDK input is untyped; assistant-ui expects ReadonlyJSONObject which Record<string,unknown> can't satisfy
          const args = (b.input ?? {}) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
          const toolResult = toolResults.get(toolCallId);
          const isUnresolved = unresolvedIds.has(toolCallId);

          parts.push({
            type: 'tool-call',
            toolCallId,
            toolName,
            args,
            result: toolResult?.result,
            isError: toolResult?.isError,
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

      if (parts.length === 0) continue;

      const isLast =
        event === events.filter((e) => e.type === 'assistant').at(-1);
      const status: ThreadMessageLike['status'] =
        isRunning && isLast
          ? { type: 'running' }
          : { type: 'complete', reason: 'stop' };

      messages.push({
        id: uuid,
        role: 'assistant',
        content: parts as ThreadMessageLike['content'],
        status,
      });
    } else if (event.type === 'user') {
      const msg = event.message as { content?: unknown[] | string };
      const isSynthetic = (event as { isSynthetic?: boolean }).isSynthetic;
      if (isSynthetic) continue;

      let userText = '';
      if (typeof msg.content === 'string') {
        userText = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Only include text blocks (not tool_result blocks)
        for (const block of msg.content) {
          const b = block as Record<string, unknown>;
          if (b.type === 'text') {
            userText += String(b.text ?? '');
          }
        }
      }

      if (!userText) continue;

      // A new user message invalidates the previous suggestion
      latestSuggestion = undefined;

      const uuid = (event as { uuid?: string }).uuid;
      messages.push({
        id: uuid,
        role: 'user',
        content: [{ type: 'text', text: userText }],
      });
    } else if ((event as { type: string }).type === 'prompt_suggestion') {
      const suggestion = (event as { suggestion?: string }).suggestion;
      if (suggestion) {
        latestSuggestion = suggestion;
      }
    }
    // 'result', 'system/init' and other types are ignored
  }

  return {
    messages,
    suggestions: latestSuggestion ? [latestSuggestion] : [],
  };
}
