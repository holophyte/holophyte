import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { UIMessage } from 'ai';
import type { PendingApproval } from '@/frontend/hooks/useSession';

/**
 * A `DynamicToolUIPart` as defined by the `ai` package.
 * We use the dynamic variant because Claude tools have arbitrary names.
 */
type DynamicToolUIPart =
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'input-streaming';
      input: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'input-available';
      input: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'approval-requested';
      input: unknown;
      approval: { id: string };
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'output-available';
      input: unknown;
      output: unknown;
    }
  | {
      type: 'dynamic-tool';
      toolName: string;
      toolCallId: string;
      state: 'output-error';
      input: unknown;
      errorText: string;
    };

/**
 * Transforms an array of SDK events into `UIMessage[]` for use with the `ai`
 * package's UI primitives.
 *
 * @param events - Accumulated SDK events from `useSession`.
 * @param isRunning - When `true`, the last assistant message is marked as
 *   streaming (text parts get `state: 'streaming'`); otherwise `'done'`.
 * @param pendingApprovals - Unresolved approval requests annotate tool parts
 *   with `approval-requested` state.
 */
export function sdkToUIMessages(
  events: SDKMessage[],
  isRunning: boolean,
  pendingApprovals: PendingApproval[],
): UIMessage[] {
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

  const messages: UIMessage[] = [];
  // Track which stable IDs we've already emitted to avoid duplicates
  const emittedIds = new Set<string>();
  const lastAssistantEvent = events
    .filter((e) => e.type === 'assistant')
    .at(-1);

  // Second pass: build UIMessage entries
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

      const isLast = latest.event === lastAssistantEvent;
      const textState = isRunning && isLast ? 'streaming' : 'done';

      // biome-ignore lint/suspicious/noExplicitAny: UIMessage parts union is complex; cast via any to satisfy the generic
      const parts: any[] = [];

      for (const block of content) {
        const b = block as Record<string, unknown>;

        if (b.type === 'text') {
          const text = String(b.text ?? '');
          if (text) {
            parts.push({ type: 'text', text, state: textState });
          }
        } else if (b.type === 'tool_use') {
          const toolCallId = String(b.id ?? '');
          const toolName = String(b.name ?? '');
          // biome-ignore lint/suspicious/noExplicitAny: SDK input is untyped
          const input = (b.input ?? {}) as any;
          const toolResult = toolResults.get(toolCallId);
          const isUnresolved = unresolvedIds.has(toolCallId);

          let part: DynamicToolUIPart;

          if (isUnresolved) {
            part = {
              type: 'dynamic-tool',
              toolName,
              toolCallId,
              state: 'approval-requested',
              input,
              approval: { id: toolCallId },
            };
          } else if (toolResult !== undefined) {
            if (toolResult.isError) {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-error',
                input,
                errorText: toolResult.result,
              };
            } else {
              part = {
                type: 'dynamic-tool',
                toolName,
                toolCallId,
                state: 'output-available',
                input,
                output: toolResult.result,
              };
            }
          } else {
            // No result yet — tool call is waiting
            part = {
              type: 'dynamic-tool',
              toolName,
              toolCallId,
              state: 'input-available',
              input,
            };
          }

          parts.push(part);
        }
      }

      if (parts.length === 0) continue;

      messages.push({
        id: latest.stableId,
        role: 'assistant',
        parts,
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

      const uuid = (event as { uuid?: string }).uuid ?? crypto.randomUUID();
      messages.push({
        id: uuid,
        role: 'user',
        parts: [{ type: 'text', text: userText }],
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
