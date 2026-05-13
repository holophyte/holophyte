import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import PermissionModePicker from './PermissionModePicker';

// Note: Radix Select + jsdom can't simulate pointer events for option clicks
// (`target.hasPointerCapture is not a function`). E2E tests cover the click
// flow; here we only assert render + accessibility surface.
describe('PermissionModePicker', () => {
  it.each([
    ['default', 'Ask'],
    ['safe-auto', 'Safe auto'],
    ['bypass', 'Bypass'],
  ] as const)('shows %s as label %s', (value, label) => {
    render(<PermissionModePicker value={value} onChange={() => {}} />);
    expect(
      screen.getByRole('combobox', { name: 'Permission mode' }),
    ).toHaveTextContent(label);
  });

  it('respects disabled', () => {
    render(
      <PermissionModePicker value="default" onChange={() => {}} disabled />,
    );
    expect(
      screen.getByRole('combobox', { name: 'Permission mode' }),
    ).toBeDisabled();
  });
});
