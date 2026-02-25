import { MessagePrimitive, useMessage } from '@assistant-ui/react';
import { ChevronRight } from 'lucide-react';

export default function CustomUserMessage() {
  const message = useMessage();
  const text = message.content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('');

  return (
    <MessagePrimitive.Root className="flex gap-2 rounded-md bg-muted/60 px-3 py-2">
      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {text}
      </p>
    </MessagePrimitive.Root>
  );
}
