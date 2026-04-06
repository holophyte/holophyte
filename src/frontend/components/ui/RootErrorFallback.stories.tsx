import type { Meta, StoryObj } from '@storybook/react-vite';
import RootErrorFallback from './RootErrorFallback';

const meta = {
  title: 'UI/RootErrorFallback',
  component: RootErrorFallback,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof RootErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Standard Error — full-page fallback with a large icon, heading, message, and recovery buttons. */
export const Default: Story = {
  args: {
    error: new Error('Unexpected application error'),
    resetErrorBoundary: () => {},
  },
};

/** A very long error message — the `line-clamp-3` class truncates overflow with an ellipsis. */
export const LongErrorMessage: Story = {
  args: {
    error: new Error(
      'UnhandledPromiseRejectionWarning: TypeError: Cannot read properties of undefined (reading "map") at KanbanColumn (KanbanColumn.tsx:42:18) at renderWithHooks (react-dom.development.js:14985:18) at mountIndeterminateComponent (react-dom.development.js:17811:5)',
    ),
    resetErrorBoundary: () => {},
  },
};
