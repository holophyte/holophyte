import { expect, test } from '@playwright/test';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
}

test('sidebar collapse toggle button is visible', async ({ page }) => {
  await waitForApp(page);
  const toggle = page.locator('aside').getByRole('button', {
    name: 'Collapse sidebar',
  });
  await expect(toggle).toBeVisible();
});

test('clicking collapse toggle hides sidebar text', async ({ page }) => {
  await waitForApp(page);
  // Verify expanded state
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible();
  await expect(page.locator('aside').locator('text=All Tasks')).toBeVisible();

  // Click collapse
  const toggle = page.locator('aside').getByRole('button', {
    name: 'Collapse sidebar',
  });
  await toggle.click();

  // Text labels should be hidden, toggle should now say "Expand"
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 5000 });
  // "Projects" header should not be visible in collapsed mode
  await expect(
    page.locator('aside').locator('text=Projects'),
  ).not.toBeVisible();
});

test('clicking expand toggle restores sidebar', async ({ page }) => {
  await waitForApp(page);

  // Collapse first
  const collapse = page.locator('aside').getByRole('button', {
    name: 'Collapse sidebar',
  });
  await collapse.click();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 5000 });

  // Now expand
  const expand = page.locator('aside').getByRole('button', {
    name: 'Expand sidebar',
  });
  await expand.click();

  // Text should be visible again
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible({
    timeout: 5000,
  });
  await expect(page.locator('aside').locator('text=All Tasks')).toBeVisible();
});

test('Cmd+B keyboard shortcut toggles sidebar', async ({ page }) => {
  await waitForApp(page);

  // Verify expanded
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible();

  // Press Cmd+B (Meta+B)
  await page.keyboard.press('Meta+b');

  // Should be collapsed
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 5000 });

  // Press again to expand
  await page.keyboard.press('Meta+b');

  // Should be expanded again
  await expect(page.locator('aside').locator('text=Projects')).toBeVisible({
    timeout: 5000,
  });
});

test('collapsed state persists across page reload', async ({ page }) => {
  await waitForApp(page);

  // Collapse the sidebar
  const toggle = page.locator('aside').getByRole('button', {
    name: 'Collapse sidebar',
  });
  await toggle.click();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 5000 });

  // Reload the page
  await page.reload();
  await page.waitForSelector('[data-testid="sidebar-header"]', {
    timeout: 30000,
  });

  // Sidebar should still be collapsed (expand button visible)
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 10000 });
});

test('collapsed sidebar still shows navigation icons', async ({ page }) => {
  await waitForApp(page);

  // Collapse
  const toggle = page.locator('aside').getByRole('button', {
    name: 'Collapse sidebar',
  });
  await toggle.click();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Expand sidebar' }),
  ).toBeVisible({ timeout: 5000 });

  // Icon-only buttons should still be accessible
  await expect(
    page.locator('aside').getByRole('button', { name: 'All Tasks' }),
  ).toBeVisible();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Seed Box' }),
  ).toBeVisible();
  await expect(
    page.locator('aside').getByRole('button', { name: 'Add project' }),
  ).toBeVisible();
});
