import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { PendingApproval } from '@/frontend/hooks/useSession';

type ContentPart = Extract<
  ThreadMessageLike['content'],
  readonly unknown[]
>[number];

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

  // Deduplicate assistant events by stable ID — the SDK sends progressive
  // snapshots of the same message (e.g., first with thinking, then with
  // tool_use). Keep the LAST snapshot for each stable ID since it has the
  // most complete content. Use message.id when available, fall back to uuid.
  const lastAssistantById = new Map<
    string,
    { event: SDKMessage; stableId: string }
  >();
  for (const event of events) {
    if (event.type === 'assistant') {
      const msg = event.message as { id?: string };
      const uuid = (event as { uuid?: string }).uuid ?? '';
      const stableId = String(msg.id ?? uuid);
      if (stableId) {
        lastAssistantById.set(stableId, { event, stableId });
      }
    }
  }

  const messages: ThreadMessageLike[] = [];
  // Track which stable IDs we've already emitted to avoid duplicates
  const emittedIds = new Set<string>();
  const lastAssistantEvent = events
    .filter((e) => e.type === 'assistant')
    .at(-1);

  // Second pass: build ThreadMessageLike entries
  for (const event of events) {
    if (event.type === 'assistant') {
      const msg = event.message as { id?: string; content?: unknown[] };
      const uuid = (event as { uuid?: string }).uuid ?? '';
      const stableId = String(msg.id ?? uuid);

      // Skip if we've already emitted this stable ID (use the latest snapshot)
      if (emittedIds.has(stableId)) continue;

      // Use the latest snapshot for this message
      const latest = lastAssistantById.get(stableId);
      if (!latest) continue;
      emittedIds.add(stableId);

      const latestMsg =
        (latest.event as { message?: { content?: unknown[] } }).message ?? {};
      const content = Array.isArray(latestMsg.content) ? latestMsg.content : [];

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

      const isLast = latest.event === lastAssistantEvent;
      const status: ThreadMessageLike['status'] =
        isRunning && isLast
          ? { type: 'running' }
          : { type: 'complete', reason: 'stop' };

      messages.push({
        id: latest.stableId,
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

      const uuid = (event as { uuid?: string }).uuid;
      messages.push({
        id: uuid,
        role: 'user',
        content: [{ type: 'text', text: userText }],
      });
    }
    // 'result', 'system/init' and other types are ignored
  }

  return messages;
}

/**
 * Extracts the most recent prompt suggestion from the SDK event stream.
 *
 * Returns the `suggestion` field from the last `prompt_suggestion` event,
 * but only if it appears after the final `user` or `assistant` event in the
 * stream. Both user and assistant events clear the suggestion. Empty or
 * whitespace-only suggestions are treated as noise (not clear signals) and
 * skipped — the SDK clears suggestions via the next user/assistant turn.
 *
 * Note: `prompt_suggestion` is not yet part of the official `SDKMessage` union
 * in `@anthropic-ai/claude-agent-sdk` types. The runtime events are emitted as
 * plain objects so the type check works, but TypeScript may flag `.suggestion`
 * access if the SDK types are tightened. Track for inclusion upstream.
 */
export function extractPromptSuggestion(events: SDKMessage[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    // biome-ignore lint/style/noNonNullAssertion: index is within bounds (loop condition guarantees i >= 0 && i < events.length)
    const event = events[i]!;
    if (event.type === 'user' || event.type === 'assistant') return null;
    if (event.type === 'prompt_suggestion') {
      const suggestion = (event as { suggestion?: string }).suggestion;
      if (suggestion?.trim()) return suggestion.trim();
    }
  }
  return null;
}
