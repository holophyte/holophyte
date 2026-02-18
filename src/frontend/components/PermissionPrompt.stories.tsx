import type { Meta, StoryObj } from '@storybook/react-vite';
import { PermissionPrompt } from './PermissionPrompt';

const meta = {
  title: 'Session/PermissionPrompt',
  component: PermissionPrompt,
  parameters: {
    layout: 'padded',
  },
  args: {
    onApprove: () => {},
    onDeny: () => {},
  },
} satisfies Meta<typeof PermissionPrompt>;

export default meta;
type Story = StoryObj<typeof meta>;

// -- Bash (most security-sensitive) --

export const BashPending: Story = {
  args: {
    approval: {
      requestId: 'req-1',
      tool: 'Bash',
      input: { command: 'rm -rf dist/' },
    },
  },
};

export const BashSafeCommand: Story = {
  args: {
    approval: {
      requestId: 'req-2',
      tool: 'Bash',
      input: { command: 'bun run lint:fix' },
    },
  },
};

// -- Edit --

export const EditPending: Story = {
  args: {
    approval: {
      requestId: 'req-3',
      tool: 'Edit',
      input: {
        file_path: 'src/server.ts',
        old_string: 'const PORT = 8080;',
        new_string: 'const PORT = Number(process.env.PORT) || 8080;',
      },
    },
  },
};

// -- Write --

export const WritePending: Story = {
  args: {
    approval: {
      requestId: 'req-4',
      tool: 'Write',
      input: {
        file_path: 'src/generated/types.ts',
        content: '// generated file\nexport type Foo = string;\n',
      },
    },
  },
};

// -- Read (less common to need approval but handled) --

export const ReadPending: Story = {
  args: {
    approval: {
      requestId: 'req-5',
      tool: 'Read',
      input: { file_path: '~/.ssh/id_rsa' },
    },
  },
};

// -- Already approved --

export const Approved: Story = {
  args: {
    approval: {
      requestId: 'req-6',
      tool: 'Bash',
      input: { command: 'bun run test' },
      resolved: { approved: true },
    },
  },
};

// -- Already denied --

export const Denied: Story = {
  args: {
    approval: {
      requestId: 'req-7',
      tool: 'Edit',
      input: { file_path: 'package.json' },
      resolved: { approved: false },
    },
  },
};

// -- Multiple stacked (render two in a wrapper) --

export const Stacked: Story = {
  render: (args) => (
    <div className="space-y-0 border border-amber-500/20 rounded overflow-hidden">
      <PermissionPrompt
        {...args}
        approval={{
          requestId: 'req-8',
          tool: 'Bash',
          input: { command: 'bun run test' },
        }}
      />
      <PermissionPrompt
        {...args}
        approval={{
          requestId: 'req-9',
          tool: 'Edit',
          input: { file_path: 'src/server.ts' },
        }}
      />
    </div>
  ),
  args: {
    approval: {
      requestId: 'req-8',
      tool: 'Bash',
      input: { command: 'bun run test' },
    },
  },
};
