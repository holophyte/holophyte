import type { Meta, StoryObj } from '@storybook/react-vite';
import ToolCallCard from './ToolCallCard';

const meta = {
  title: 'Session/ToolCallCard',
  component: ToolCallCard,
  parameters: {
    layout: 'padded',
  },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Read tool --

export const ReadFile: Story = {
  args: {
    toolName: 'Read',
    input: { file_path: 'src/claude/manager.ts' },
  },
};

export const ReadFileWithResult: Story = {
  args: {
    toolName: 'Read',
    input: { file_path: 'src/claude/manager.ts', limit: 50 },
    result:
      "import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';\nimport { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';\n// ... (50 lines)",
  },
};

// -- Edit tool --

export const EditFile: Story = {
  args: {
    toolName: 'Edit',
    input: {
      file_path: 'src/frontend/components/SessionPanel.tsx',
      old_string: 'const foo = 1;',
      new_string: 'const foo = 2;',
    },
  },
};

// -- Bash tool --

export const BashCommand: Story = {
  args: {
    toolName: 'Bash',
    input: { command: 'bun run test' },
  },
};

export const BashCommandWithResult: Story = {
  args: {
    toolName: 'Bash',
    input: { command: 'bun run test' },
    result:
      'PASS src/claude/manager.test.ts\n✓ startSession spawns the iterator\n✓ stopSession aborts the controller\n\nAll tests passed (2)',
  },
};

export const BashCommandWithError: Story = {
  args: {
    toolName: 'Bash',
    input: { command: 'bun run build' },
    result: "error: Could not resolve './missing-module'",
    isError: true,
  },
};

// -- Grep tool --

export const GrepSearch: Story = {
  args: {
    toolName: 'Grep',
    input: { pattern: 'useSession', path: 'src/frontend' },
  },
};

// -- Glob tool --

export const GlobPattern: Story = {
  args: {
    toolName: 'Glob',
    input: { pattern: '**/*.stories.tsx' },
  },
};

// -- Web tools --

export const WebFetch: Story = {
  args: {
    toolName: 'WebFetch',
    input: { url: 'https://docs.anthropic.com/en/api/getting-started' },
  },
};

export const WebSearch: Story = {
  args: {
    toolName: 'WebSearch',
    input: { query: 'Bun native PTY documentation' },
  },
};

// -- Unknown tool --

export const UnknownTool: Story = {
  args: {
    toolName: 'TodoWrite',
    input: { todos: [{ content: 'Fix the bug', status: 'in_progress' }] },
  },
};

// -- Long result truncation --

export const LongResult: Story = {
  args: {
    toolName: 'Read',
    input: { file_path: 'bun.lock' },
    result: 'x '.repeat(1200), // > 2000 chars
  },
};
