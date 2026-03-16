import type { Meta, StoryObj } from '@storybook/react-vite';
import { Search, X } from 'lucide-react';
import HolophyteIcon from '../icons/HolophyteIcon';
import PageHeader from './PageHeader';

const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Simple: Story = {
  args: {
    children: <h1 className="text-lg font-semibold">Page Title</h1>,
  },
};

export const WithIcon: Story = {
  args: {
    className: 'gap-2',
    children: (
      <>
        <HolophyteIcon className="h-5 w-5" />
        <span className="text-lg font-semibold">Holophyte</span>
      </>
    ),
  },
};

export const WithActions: Story = {
  args: {
    className: 'justify-between px-6',
    children: (
      <>
        <h1 className="text-lg font-semibold">All Tasks</h1>
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <button type="button" className="p-1">
            <X className="h-4 w-4" />
          </button>
        </div>
      </>
    ),
  },
};
