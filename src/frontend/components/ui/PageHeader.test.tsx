import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PageHeader from './PageHeader';

describe('PageHeader', () => {
  it('renders children', () => {
    render(<PageHeader>My Title</PageHeader>);
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('applies base classes', () => {
    const { container } = render(<PageHeader>Title</PageHeader>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('h-14');
    expect(el.className).toContain('border-b');
    expect(el.className).toContain('flex');
  });

  it('merges custom className', () => {
    const { container } = render(
      <PageHeader className="justify-between px-6">Title</PageHeader>,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('justify-between');
    expect(el.className).toContain('px-6');
  });

  it('passes through HTML attributes', () => {
    render(<PageHeader data-testid="header">Title</PageHeader>);
    expect(screen.getByTestId('header')).toBeInTheDocument();
  });
});
