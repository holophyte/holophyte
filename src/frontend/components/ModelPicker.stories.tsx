import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ClaudeModelId } from './ModelPicker';
import ModelPicker, { CLAUDE_MODELS, DEFAULT_MODEL } from './ModelPicker';

const meta = {
  title: 'Session/ModelPicker',
  component: ModelPicker,
  parameters: {
    layout: 'padded',
  },
  argTypes: {
    value: {
      control: 'select',
      options: CLAUDE_MODELS.map((m) => m.id) as ClaudeModelId[],
      labels: Object.fromEntries(CLAUDE_MODELS.map((m) => [m.id, m.label])),
    },
  },
  args: {
    onChange: () => {},
  },
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DefaultSelection: Story = {
  args: {
    value: DEFAULT_MODEL,
  },
};

export const OpusSelected: Story = {
  args: {
    value: 'claude-opus-4-6',
  },
};

export const Sonnet46Selected: Story = {
  args: {
    value: 'claude-sonnet-4-6',
  },
};

export const Sonnet45Selected: Story = {
  args: {
    value: 'claude-sonnet-4-5-20250929',
  },
};

export const HaikuSelected: Story = {
  args: {
    value: 'claude-haiku-4-5-20251001',
  },
};
