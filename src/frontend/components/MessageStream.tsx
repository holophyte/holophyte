import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { cn } from '@/frontend/lib/utils';
import ToolCallCard from './ToolCallCard';

/** Props for {@link MessageStream}. */
interface MessageStreamProps {
  /**
   * Accumulated SDK events from {@link useSession}. The component derives
   * rendered messages from `assistant` and `user` event types.
   */
  events: SDKMessage[];
  /**
   * When `true` and no messages have been rendered yet, shows a "Starting
   * session…" spinner. Should be `true` from session launch until the first
   * event arrives.
   */
  isLoading: boolean;
}

// Extract text content from an assistant message's content array
function getAssistantText(message: { content?: unknown[] }): string {
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter(
      (b): b is { type: 'text'; text: string } =>
        typeof b === 'object' &&
        b !== null &&
        (b as Record<string, unknown>).type === 'text',
    )
    .map((b) => b.text)
    .join('');
}

// Extract tool use blocks from an assistant message's content array
function getToolUseBlocks(message: { content?: unknown[] }): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  if (!Array.isArray(message.content)) return [];
  return message.content
    .filter(
      (
        b,
      ): b is {
        type: 'tool_use';
        id: string;
        name: string;
        input: Record<string, unknown>;
      } =>
        typeof b === 'object' &&
        b !== null &&
        (b as Record<string, unknown>).type === 'tool_use',
    )
    .map((b) => ({ id: b.id, name: b.name, input: b.input }));
}

/** Rendered message from the stream. */
interface RenderedMessage {
  uuid: string;
  role: 'assistant' | 'user';
  text: string;
  toolUses: Array<{
    id: string;
    name: string;
    input: Record<string, unknown>;
    result?: string;
    isError?: boolean;
  }>;
}

function buildMessages(events: SDKMessage[]): RenderedMessage[] {
  const messages: RenderedMessage[] = [];
  const toolResults = new Map<string, { result: string; isError: boolean }>();

  // First pass: collect tool results from user messages (tool_result blocks)
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
              resultText = content
                .filter(
                  (c): c is { type: 'text'; text: string } =>
                    typeof c === 'object' &&
                    c !== null &&
                    (c as Record<string, unknown>).type === 'text',
                )
                .map((c) => c.text)
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

  // Second pass: build assistant messages and user messages (non-tool-result)
  for (const event of events) {
    if (event.type === 'assistant') {
      const msg = event.message as { content?: unknown[] };
      const text = getAssistantText(msg);
      const toolUses = getToolUseBlocks(msg).map((tu) => ({
        ...tu,
        result: toolResults.get(tu.id)?.result,
        isError: toolResults.get(tu.id)?.isError,
      }));

      if (text || toolUses.length > 0) {
        messages.push({
          uuid: (event as { uuid?: string }).uuid ?? '',
          role: 'assistant',
          text,
          toolUses,
        });
      }
    } else if (event.type === 'user') {
      // Only show synthetic user messages that are actual text (not tool results)
      const msg = event.message as { content?: unknown[] | string };
      let userText = '';
      if (typeof msg.content === 'string') {
        userText = msg.content;
      } else if (Array.isArray(msg.content)) {
        userText = msg.content
          .filter(
            (b): b is { type: 'text'; text: string } =>
              typeof b === 'object' &&
              b !== null &&
              (b as Record<string, unknown>).type === 'text',
          )
          .map((b) => b.text)
          .join('');
      }
      if (userText && !(event as { isSynthetic?: boolean }).isSynthetic) {
        messages.push({
          uuid: (event as { uuid?: string }).uuid ?? '',
          role: 'user',
          text: userText,
          toolUses: [],
        });
      }
    }
  }

  return messages;
}

/**
 * Scrollable conversation view that renders the Claude Code session event
 * stream as a chat-like UI.
 *
 * - `assistant` events render as left-aligned markdown bubbles with inline
 *   {@link ToolCallCard} cards for any tool-use blocks.
 * - `user` events render as right-aligned bubbles (only text messages, not
 *   internal tool-result blocks).
 * - Auto-scrolls to the bottom as new events arrive; pauses auto-scroll
 *   while the user is scrolled up to read earlier content.
 * - Shows a loading spinner while `isLoading` is `true` and no messages exist.
 */
export default function MessageStream({
  events,
  isLoading,
}: MessageStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  // Auto-scroll to bottom unless user scrolled up
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally using events.length as dep trigger
  useEffect(() => {
    const container = containerRef.current;
    const bottom = bottomRef.current;
    if (!container || !bottom) return;
    if (!userScrolledRef.current) {
      bottom.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [events.length]);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      50;
    userScrolledRef.current = !atBottom;
  }, []);

  const messages = useMemo(() => buildMessages(events), [events]);

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scroll-smooth"
    >
      {isLoading && messages.length === 0 && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Starting session…</span>
        </div>
      )}

      {messages.map((msg, i) => (
        <div key={msg.uuid || i} className={cn('flex flex-col gap-1')}>
          {msg.role === 'user' && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed">
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
              </div>
            </div>
          )}

          {msg.role === 'assistant' && (
            <div className="flex flex-col gap-1">
              {msg.toolUses.map((tu) => (
                <ToolCallCard
                  key={tu.id}
                  toolName={tu.name}
                  input={tu.input}
                  result={tu.result}
                  isError={tu.isError}
                />
              ))}
              {msg.text && (
                <div className="prose prose-sm prose-invert max-w-none text-foreground text-sm leading-relaxed [&_pre]:overflow-x-auto [&_pre]:text-xs [&_code]:text-xs">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {msg.text}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </div>
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
