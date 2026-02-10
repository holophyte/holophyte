import type { Meta, StoryObj } from '@storybook/react-vite';
import Separator from './Separator';

const meta = {
  title: 'UI/Separator',
  component: Separator,
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  decorators: [
    (Story) => (
      <div className="w-64">
        <p className="text-sm">Above</p>
        <Story />
        <p className="text-sm">Below</p>
      </div>
    ),
  ],
};

export const Vertical: Story = {
  args: { orientation: 'vertical' },
  decorators: [
    (Story) => (
      <div className="flex h-8 items-center gap-4">
        <span className="text-sm">Left</span>
        <Story />
        <span className="text-sm">Right</span>
      </div>
    ),
  ],
};
