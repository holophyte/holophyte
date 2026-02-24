import type { Meta, StoryObj } from '@storybook/react-vite';
import SessionStatusDot from './SessionStatusDot';

const meta = {
  title: 'Session/SessionStatusDot',
  component: SessionStatusDot,
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    status: {
      control: 'select',
      options: ['running', 'idle', 'failed'],
    },
  },
} satisfies Meta<typeof SessionStatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Green pulsing dot — at least one session on the task is actively running. */
export const Running: Story = {
  args: { status: 'running' },
};

/** Gray dot — session(s) exist but none are currently active (turn finished). */
export const Idle: Story = {
  args: { status: 'idle' },
};

/** Red dot — the session ended with an SDK error. Still resumable. */
export const Failed: Story = {
  args: { status: 'failed' },
};

/** All three states side by side, as they appear on a kanban board scan. */
export const AllStates: Story = {
  render: () => (
    <div className="flex items-center gap-4 p-4">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SessionStatusDot status="running" />
        Running
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SessionStatusDot status="idle" />
        Idle
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SessionStatusDot status="failed" />
        Failed
      </div>
    </div>
  ),
  args: { status: 'running' },
};
