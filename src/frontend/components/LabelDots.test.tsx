import type { Doc } from '@convex/_generated/dataModel';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabelDots } from './LabelPicker';

function makeLabel(name: string, color = '#ef4444'): Doc<'labels'> {
  return {
    _id: `label_${name}` as Doc<'labels'>['_id'],
    _creationTime: Date.now(),
    createdAt: Date.now(),
    orgId: 'org_test' as Doc<'labels'>['orgId'],
    name,
    color,
  };
}

describe('LabelDots', () => {
  it('returns null for empty labels', () => {
    const { container } = render(<LabelDots labels={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders all labels when no max', () => {
    const labels = [makeLabel('Bug'), makeLabel('Feature'), makeLabel('UI')];
    render(<LabelDots labels={labels} />);
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.getByText('UI')).toBeInTheDocument();
  });

  it('renders all labels when count is within max', () => {
    const labels = [makeLabel('Bug'), makeLabel('Feature')];
    render(<LabelDots labels={labels} max={3} />);
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it('truncates and shows overflow count when exceeding max', () => {
    const labels = [
      makeLabel('Bug'),
      makeLabel('Feature'),
      makeLabel('UI'),
      makeLabel('Backend'),
      makeLabel('Urgent'),
    ];
    render(<LabelDots labels={labels} max={2} />);
    expect(screen.getByText('Bug')).toBeInTheDocument();
    expect(screen.getByText('Feature')).toBeInTheDocument();
    expect(screen.queryByText('UI')).not.toBeInTheDocument();
    expect(screen.queryByText('Backend')).not.toBeInTheDocument();
    expect(screen.queryByText('Urgent')).not.toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('shows +1 when one label overflows', () => {
    const labels = [makeLabel('A'), makeLabel('B')];
    render(<LabelDots labels={labels} max={1} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('B')).not.toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });
});
