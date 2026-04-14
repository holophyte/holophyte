import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

test('sidebar collapse toggle button is visible', async ({ page }) => {
  await waitForApp(page);
  const toggle = page.getByTestId('sidebar-toggle');
  await expect(toggle).toBeVisible();
});

test('clicking collapse toggle hides sidebar text', async ({ page }) => {
  await waitForApp(page);
  // Verify expanded state
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible();
  await expect(page.locator('aside').locator('text=All Tasks')).toBeVisible();

  // Click collapse
  const toggle = page.getByTestId('sidebar-toggle');
  await toggle.click();

  // Toggle should now say "Expand"
  await expect(toggle).toHaveAttribute('aria-label', 'Expand sidebar', {
    timeout: 5000,
  });
  // "Projects" header should not be visible in collapsed mode
  await expect(
    page.locator('aside').locator('text=Projects'),
  ).not.toBeVisible();

  // Icon-only buttons should still be accessible by aria-label
  await expect(
    page.locator('aside').getByRole('button', { name: 'All Tasks' }),
  ).toBeVisible();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Seed Box' }),
  ).toBeVisible();
});

test('clicking expand toggle restores sidebar', async ({ page }) => {
  await waitForApp(page);

  // Collapse first
  const toggle = page.getByTestId('sidebar-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Expand sidebar', {
    timeout: 5000,
  });

  // Now expand
  await toggle.click();

  // Text should be visible again
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('aside').locator('text=All Tasks')).toBeVisible();
});

test('clicking the Holophyte logo toggles the sidebar', async ({ page }) => {
  await waitForApp(page);

  const brandToggle = page.getByTestId('sidebar-brand-toggle');
  await expect(brandToggle).toBeVisible();

  // Click brand toggle to collapse
  await brandToggle.click();
  await expect(brandToggle).toHaveAttribute('aria-label', 'Expand sidebar', {
    timeout: 5000,
  });

  // Click brand toggle to expand
  await brandToggle.click();
  await expect(brandToggle).toHaveAttribute('aria-label', 'Collapse sidebar', {
    timeout: 5000,
  });
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible({
    timeout: 5000,
  });
});

test('Cmd+B keyboard shortcut toggles sidebar', async ({ page }) => {
  await waitForApp(page);

  // Wait for sidebar to stabilize after hydration
  const toggle = page.getByTestId('sidebar-toggle');
  await expect(toggle).toBeVisible({ timeout: 10000 });

  // Press Ctrl+B (works on Linux CI; Meta+B on Mac)
  await page.keyboard.press('ControlOrMeta+b');

  // Should be collapsed
  await expect(toggle).toHaveAttribute('aria-label', 'Expand sidebar', {
    timeout: 5000,
  });

  // Press again to expand
  await page.keyboard.press('ControlOrMeta+b');

  // Should be expanded again
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible({
    timeout: 5000,
  });
});

test('collapsed state persists across page reload', async ({ page }) => {
  await waitForApp(page);

  // Collapse the sidebar
  const toggle = page.getByTestId('sidebar-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-label', 'Expand sidebar', {
    timeout: 5000,
  });

  // Reload the page
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar-header"]', {
    timeout: 30000,
  });

  // Sidebar should still be collapsed (expand button visible)
  await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute(
    'aria-label',
    'Expand sidebar',
    { timeout: 10000 },
  );
});
