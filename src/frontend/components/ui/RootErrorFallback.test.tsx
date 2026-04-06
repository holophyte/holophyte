import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RootErrorFallback from './RootErrorFallback';

const noop = () => {};

describe('RootErrorFallback', () => {
  describe('structure', () => {
    it('has role="alert" for accessibility', () => {
      render(
        <RootErrorFallback
          error={new Error('oops')}
          resetErrorBoundary={noop}
        />,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('icon has aria-hidden="true"', () => {
      const { container } = render(
        <RootErrorFallback
          error={new Error('oops')}
          resetErrorBoundary={noop}
        />,
      );
      const svg = container.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  describe('heading', () => {
    it('renders "Something went wrong" heading', () => {
      render(
        <RootErrorFallback
          error={new Error('any')}
          resetErrorBoundary={noop}
        />,
      );
      expect(
        screen.getByRole('heading', { name: 'Something went wrong' }),
      ).toBeInTheDocument();
    });
  });

  describe('error message display', () => {
    it('displays the message when error is an Error instance', () => {
      render(
        <RootErrorFallback
          error={new Error('Unexpected server error')}
          resetErrorBoundary={noop}
        />,
      );
      expect(screen.getByText('Unexpected server error')).toBeInTheDocument();
    });

    it('displays stringified value when error is a string', () => {
      render(
        <RootErrorFallback error="fatal failure" resetErrorBoundary={noop} />,
      );
      expect(screen.getByText('fatal failure')).toBeInTheDocument();
    });

    it('displays stringified value when error is a plain object', () => {
      render(
        <RootErrorFallback error={{ code: 500 }} resetErrorBoundary={noop} />,
      );
      expect(screen.getByText('[object Object]')).toBeInTheDocument();
    });

    it('displays stringified value when error is a number', () => {
      render(<RootErrorFallback error={500} resetErrorBoundary={noop} />);
      expect(screen.getByText('500')).toBeInTheDocument();
    });
  });

  describe('Reload page button', () => {
    it('renders a "Reload page" button', () => {
      render(
        <RootErrorFallback error={new Error('x')} resetErrorBoundary={noop} />,
      );
      expect(
        screen.getByRole('button', { name: 'Reload page' }),
      ).toBeInTheDocument();
    });

    it('calls window.location.reload() when clicked', async () => {
      const reload = vi.fn();
      const original = window.location;
      Object.defineProperty(window, 'location', {
        value: { ...original, reload },
        writable: true,
      });
      render(
        <RootErrorFallback error={new Error('x')} resetErrorBoundary={noop} />,
      );
      await userEvent.click(
        screen.getByRole('button', { name: 'Reload page' }),
      );
      expect(reload).toHaveBeenCalledOnce();
      Object.defineProperty(window, 'location', {
        value: original,
        writable: true,
      });
    });
  });
});
