import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Meta, StoryObj } from '@storybook/react-vite';
import MessageStream from './MessageStream';

const meta = {
  title: 'Session/MessageStream',
  component: MessageStream,
  parameters: {
    layout: 'padded',
  },
  decorators: [
    (Story) => (
      <div className="h-[500px] flex flex-col bg-background border rounded overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MessageStream>;

export default meta;
type Story = StoryObj<typeof meta>;

// Helper to build a minimal assistant event
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
    uuid: crypto.randomUUID(),
  } as unknown as SDKMessage;
}

// Helper to build a tool result user event
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
    uuid: crypto.randomUUID(),
  } as unknown as SDKMessage;
}

// Helper to build a user text message event
function userTextEvent(text: string): SDKMessage {
  return {
    type: 'user',
    message: { content: [{ type: 'text', text }] },
    uuid: crypto.randomUUID(),
  } as unknown as SDKMessage;
}

export const Loading: Story = {
  args: {
    events: [],
    isLoading: true,
  },
};

export const Empty: Story = {
  args: {
    events: [],
    isLoading: false,
  },
};

export const SingleAssistantMessage: Story = {
  args: {
    events: [
      assistantEvent(
        "I'll start by reading the manager file to understand the current session handling.",
      ),
    ],
    isLoading: false,
  },
};

export const WithToolCall: Story = {
  args: {
    events: [
      assistantEvent('Let me read the server file first.', [
        { id: 'tu-1', name: 'Read', input: { file_path: 'src/server.ts' } },
      ]),
      toolResultEvent('tu-1', 'import { serve } from "bun";\n// server setup'),
      assistantEvent(
        "I can see the server is using `Bun.serve()`. Now I'll check the session manager.",
      ),
    ],
    isLoading: false,
  },
};

export const WithMarkdown: Story = {
  args: {
    events: [
      assistantEvent(
        `Here is a summary of the changes I made:

## Changes

- **Added** \`useSession\` hook for WebSocket management
- **Replaced** \`TerminalPanel\` with \`SessionPanel\`
- **Removed** xterm.js dependency

### Code example

\`\`\`typescript
const { events, approve, deny } = useSession(sessionId);
\`\`\`

The hook handles reconnection and pending approval replay automatically.`,
      ),
    ],
    isLoading: false,
  },
};

export const WithUserMessage: Story = {
  args: {
    events: [
      assistantEvent(
        "I've finished reading the codebase. What would you like me to do next?",
      ),
      userTextEvent('Please add TSDoc comments to all exported functions.'),
      assistantEvent("I'll add TSDoc comments to all exported functions now."),
    ],
    isLoading: false,
  },
};

export const MultipleToolCalls: Story = {
  args: {
    events: [
      assistantEvent(
        "I'll look at several files to understand the architecture.",
        [
          { id: 'tu-2', name: 'Read', input: { file_path: 'src/server.ts' } },
          { id: 'tu-3', name: 'Glob', input: { pattern: '**/*.ts' } },
          { id: 'tu-4', name: 'Bash', input: { command: 'bun run test' } },
        ],
      ),
      toolResultEvent('tu-2', 'import Bun from "bun";\n...'),
      toolResultEvent('tu-3', 'src/server.ts\nsrc/claude/manager.ts\n...'),
      toolResultEvent('tu-4', 'All tests passed (12)'),
      assistantEvent(
        'All tests pass and the codebase structure is clear. Let me now make the changes.',
      ),
    ],
    isLoading: false,
  },
};

export const WithErrorToolResult: Story = {
  args: {
    events: [
      assistantEvent('Let me run the tests to see if everything works.', [
        { id: 'tu-5', name: 'Bash', input: { command: 'bun run test' } },
      ]),
      toolResultEvent('tu-5', "error: Cannot find module './missing'", true),
      assistantEvent(
        'The tests failed because of a missing import. Let me fix that.',
      ),
    ],
    isLoading: false,
  },
};

export const LongConversation: Story = {
  args: {
    events: [
      assistantEvent('Starting analysis of the codebase.'),
      assistantEvent('Reading key files.', [
        { id: 'tu-6', name: 'Read', input: { file_path: 'src/server.ts' } },
        {
          id: 'tu-7',
          name: 'Read',
          input: { file_path: 'src/claude/manager.ts' },
        },
      ]),
      toolResultEvent('tu-6', 'server source...'),
      toolResultEvent('tu-7', 'manager source...'),
      assistantEvent("I've read the main files. Let me check the frontend."),
      assistantEvent('Searching for components.', [
        {
          id: 'tu-8',
          name: 'Glob',
          input: { pattern: 'src/frontend/**/*.tsx' },
        },
      ]),
      toolResultEvent('tu-8', 'SessionPanel.tsx\nMessageStream.tsx\n...'),
      userTextEvent('Can you also check the hooks directory?'),
      assistantEvent('Of course.', [
        {
          id: 'tu-9',
          name: 'Glob',
          input: { pattern: 'src/frontend/hooks/*.ts' },
        },
      ]),
      toolResultEvent('tu-9', 'useSession.ts\nuseStickyValue.ts'),
      assistantEvent(
        `Here is my full analysis:

## Architecture Summary

The session panel uses a **WebSocket-first** approach:

1. \`useSession\` hook manages the WS connection
2. \`SessionPanel\` renders the conversation
3. Tool calls appear as collapsible \`ToolCallCard\` components
4. Permission prompts appear as \`PermissionPrompt\` cards

This is a significant improvement over the previous xterm.js approach.`,
      ),
    ],
    isLoading: false,
  },
};
