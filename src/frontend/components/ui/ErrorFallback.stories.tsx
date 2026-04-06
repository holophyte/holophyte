import type { Meta, StoryObj } from '@storybook/react-vite';
import ErrorFallback from './ErrorFallback';

const meta = {
  title: 'UI/ErrorFallback',
  component: ErrorFallback,
  decorators: [
    (Story) => (
      <div className="h-64 w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorFallback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Standard Error with a short message — shows the triangle icon, message, and retry button. */
export const Default: Story = {
  args: {
    error: new Error('Failed to load task data'),
    resetErrorBoundary: () => {},
  },
};

/** A very long error message — the `line-clamp-3` class truncates overflow with an ellipsis. */
export const LongErrorMessage: Story = {
  args: {
    error: new Error(
      'UnhandledPromiseRejectionWarning: TypeError: Cannot read properties of undefined (reading "map") at KanbanColumn (KanbanColumn.tsx:42:18) at renderWithHooks (react-dom.development.js:14985:18) at mountIndeterminateComponent',
    ),
    resetErrorBoundary: () => {},
  },
};

/** Non-Error thrown value — the component falls back to `String(error)` for display. */
export const NonErrorObject: Story = {
  args: {
    error: 'Network request failed: 503 Service Unavailable',
    resetErrorBoundary: () => {},
  },
};
