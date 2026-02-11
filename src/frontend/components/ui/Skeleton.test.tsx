import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Skeleton from './Skeleton';

describe('Skeleton', () => {
  it('renders a div with animate-pulse', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('bg-muted');
    expect(el.className).toContain('rounded');
  });

  it('merges custom className for sizing', () => {
    const { container } = render(<Skeleton className="h-9 w-full" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('h-9');
    expect(el.className).toContain('w-full');
    expect(el.className).toContain('animate-pulse');
  });

  it('passes through HTML attributes', () => {
    const { container } = render(
      <Skeleton data-testid="skel" aria-hidden="true" />,
    );
    const el = container.firstChild as HTMLElement;
    expect(el.dataset.testid).toBe('skel');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
