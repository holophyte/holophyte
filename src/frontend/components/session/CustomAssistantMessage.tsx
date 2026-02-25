import type { TextMessagePartComponent } from '@assistant-ui/react';
import { MessagePrimitive } from '@assistant-ui/react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

const REMARK_PLUGINS = [remarkGfm];
const REHYPE_PLUGINS = [rehypeHighlight];

const MarkdownText: TextMessagePartComponent = ({ text }) => {
  return (
    <div className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-code:text-foreground prose-code:before:content-none prose-code:after:content-none prose-a:text-primary prose-blockquote:text-muted-foreground prose-p:my-1 prose-headings:my-2 prose-pre:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-table:my-2 text-sm leading-relaxed [&_pre]:overflow-x-auto [&_pre]:text-xs [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_code]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-foreground [&_th]:bg-muted/50 [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
};

export default function CustomAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col gap-2">
      <MessagePrimitive.Content
        components={{
          Text: MarkdownText,
        }}
      />
    </MessagePrimitive.Root>
  );
}
