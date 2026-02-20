import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ArrowDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';
import { cn } from '@/frontend/lib/utils';
import ToolCallCard from './ToolCallCard';
import Button from './ui/Button';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

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
  /**
   * When `true`, shows a rotating star indicator at the bottom of the stream
   * to signal that Claude is actively processing. Should reflect `status ===
   * 'running'` from the session.
   */
  isProcessing: boolean;
  /** Seconds elapsed in the current running state, if available. */
  thinkingElapsedSeconds?: number;
  /** Resolved permission prompts rendered as contextual transcript entries. */
  resolvedApprovals?: Array<{
    requestId: string;
    tool: string;
    resolved?: { approved: boolean };
  }>;
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

function formatThinkingElapsed(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
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
 * - `assistant` events render as markdown blocks with inline {@link ToolCallCard}
 *   cards for any tool-use blocks.
 * - `user` events render as highlighted instruction blocks.
 * - Auto-scrolls to the bottom while reading live output and pauses when the
 *   user scrolls away from the bottom.
 * - Shows a jump-to-latest control when the stream is not pinned.
 */
export default function MessageStream({
  events,
  isLoading,
  isProcessing,
  thinkingElapsedSeconds,
  resolvedApprovals = [],
}: MessageStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const messages = useMemo(() => buildMessages(events), [events]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
    setIsAtBottom(true);
  }, []);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const threshold = 56;
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      threshold;
    setIsAtBottom(atBottom);
  }, []);

  // Auto-scroll while the user is at the bottom; no smooth behavior to avoid jank.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger on new stream content
  useEffect(() => {
    if (!isAtBottom) return;
    scrollToBottom();
  }, [events.length, isAtBottom, scrollToBottom]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key === 'ArrowDown' &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault();
        scrollToBottom();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [scrollToBottom]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        <div className="mx-auto w-full max-w-[72ch] space-y-5">
          {isLoading && messages.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin pulse-spin" />
              <span>Starting session…</span>
            </div>
          )}

          {messages.map((msg, index) => (
            <div
              key={msg.uuid || index}
              className={cn(
                'flex flex-col gap-1.5',
                msg.role === 'assistant' && index > 0 && 'pt-4 border-t',
              )}
            >
              {msg.role === 'user' && (
                <div className="flex gap-2 rounded-md bg-muted/60 px-3 py-2">
                  <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap break-words">
                    {msg.text}
                  </p>
                </div>
              )}

              {msg.role === 'assistant' && (
                <div className="flex flex-col gap-2">
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
                    <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-blockquote:text-muted-foreground prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-2 text-sm leading-relaxed [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_code]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-foreground [&_th]:bg-muted/50 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5">
                      <ReactMarkdown
                        remarkPlugins={REMARK_PLUGINS}
                        rehypePlugins={REHYPE_PLUGINS}
                      >
                        {msg.text}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {resolvedApprovals.map((approval) => (
            <div
              key={approval.requestId}
              className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
            >
              Permission {approval.resolved?.approved ? 'approved' : 'denied'}:{' '}
              {approval.tool}
            </div>
          ))}

          {isProcessing && (
            <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground/70">
              <Sparkles className="h-3.5 w-3.5 pulse-spin animate-[pulse-spin_2s_linear_infinite]" />
              <span>
                Thinking…
                {typeof thinkingElapsedSeconds === 'number'
                  ? ` ${formatThinkingElapsed(thinkingElapsedSeconds)}`
                  : ''}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {!isAtBottom && (
        <div className="jump-to-latest pointer-events-none absolute bottom-4 right-4">
          <Button
            size="sm"
            className="pointer-events-auto min-h-11 rounded-full px-3 shadow-lg"
            onClick={scrollToBottom}
          >
            <ArrowDown className="h-4 w-4" />
            Jump to latest
          </Button>
        </div>
      )}
    </div>
  );
}
