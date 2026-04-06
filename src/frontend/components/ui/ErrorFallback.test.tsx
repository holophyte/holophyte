import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ErrorFallback from './ErrorFallback';

const noop = () => {};

describe('ErrorFallback', () => {
  describe('structure', () => {
    it('has role="alert" for accessibility', () => {
      render(
        <ErrorFallback error={new Error('oops')} resetErrorBoundary={noop} />,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('container has tabIndex={-1} for focus management', () => {
      render(
        <ErrorFallback error={new Error('oops')} resetErrorBoundary={noop} />,
      );
      expect(screen.getByRole('alert')).toHaveAttribute('tabindex', '-1');
    });

    it('icon has aria-hidden="true"', () => {
      const { container } = render(
        <ErrorFallback error={new Error('oops')} resetErrorBoundary={noop} />,
      );
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('heading', () => {
    it('renders "Something went wrong" heading', () => {
      render(
        <ErrorFallback error={new Error('any')} resetErrorBoundary={noop} />,
      );
      expect(
        screen.getByRole('heading', { name: 'Something went wrong' }),
      ).toBeInTheDocument();
    });
  });

  describe('error message display', () => {
    it('displays the message when error is an Error instance', () => {
      render(
        <ErrorFallback
          error={new Error('Network request failed')}
          resetErrorBoundary={noop}
        />,
      );
      expect(screen.getByText('Network request failed')).toBeInTheDocument();
    });

    it('displays stringified value when error is a string', () => {
      render(<ErrorFallback error="something bad" resetErrorBoundary={noop} />);
      expect(screen.getByText('something bad')).toBeInTheDocument();
    });

    it('displays stringified value when error is a plain object', () => {
      render(<ErrorFallback error={{ code: 42 }} resetErrorBoundary={noop} />);
      expect(screen.getByText('[object Object]')).toBeInTheDocument();
    });

    it('displays stringified value when error is a number', () => {
      render(<ErrorFallback error={404} resetErrorBoundary={noop} />);
      expect(screen.getByText('404')).toBeInTheDocument();
    });
  });

  describe('Try again button', () => {
    it('renders a "Try again" button', () => {
      render(
        <ErrorFallback error={new Error('x')} resetErrorBoundary={noop} />,
      );
      expect(
        screen.getByRole('button', { name: 'Try again' }),
      ).toBeInTheDocument();
    });

    it('calls resetErrorBoundary when clicked', async () => {
      const reset = vi.fn();
      render(
        <ErrorFallback error={new Error('x')} resetErrorBoundary={reset} />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(reset).toHaveBeenCalledOnce();
    });
  });
});
