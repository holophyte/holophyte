import type { Meta, StoryObj } from '@storybook/react-vite';
import Textarea from './Textarea';

const meta = {
  title: 'UI/Textarea',
  component: Textarea,
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { placeholder: 'Type your message...' },
};

export const WithValue: Story = {
  args: { defaultValue: 'This is a textarea with some content.' },
};

export const Disabled: Story = {
  args: { placeholder: 'Disabled', disabled: true },
};
