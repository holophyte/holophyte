import { expect, test } from '@playwright/test';

// Wait for app to hydrate by checking for the sidebar header
async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 15000 });
}

test('app loads and shows sidebar', async ({ page }) => {
  await waitForApp(page);
  await expect(page.locator('text=Holophyte')).toBeVisible();
  await expect(page.getByRole('button', { name: 'All Tasks' })).toBeVisible();
});

test('sidebar shows seed box and projects', async ({ page }) => {
  await waitForApp(page);
  await expect(page.locator('text=Seed Box')).toBeVisible();
  await expect(page.locator('text=Projects')).toBeVisible();
});

test('kanban columns are visible', async ({ page }) => {
  await waitForApp(page);
  // Backlog is collapsed by default, so only the other 4 columns show as headers
  await expect(page.locator('text=To Do')).toBeVisible();
  await expect(page.locator('text=In Progress')).toBeVisible();
  await expect(page.locator('text=Review')).toBeVisible();
  await expect(page.locator('text=Done')).toBeVisible();
});

test('collapsed backlog strip is visible by default', async ({ page }) => {
  await waitForApp(page);
  // The collapsed backlog shows as a vertical strip with "Backlog" text
  const collapsed = page.locator('button', { hasText: 'Backlog' });
  await expect(collapsed).toBeVisible();
});

test('clicking collapsed backlog expands it', async ({ page }) => {
  await waitForApp(page);
  const collapsed = page.locator('button', { hasText: 'Backlog' });
  await collapsed.click();
  // Now backlog column header should be visible as a column
  const columnHeader = page.locator(
    '[role="group"][aria-label="Backlog column"]',
  );
  await expect(columnHeader).toBeVisible();
});

test('per-lane add buttons are not visible without repo selected', async ({
  page,
}) => {
  await waitForApp(page);
  // Without a repo, the "+ Add" buttons should not appear in any column
  const addButtons = page.locator('button', { hasText: /^Add$/ });
  await expect(addButtons).toHaveCount(0);
});

test('add repo dialog opens', async ({ page }) => {
  await waitForApp(page);
  // Click the + button inside the Projects section header
  const addButton = page
    .locator('div')
    .filter({ hasText: /^Projects$/ })
    .locator('button');
  await addButton.click();
  await expect(page.locator('text=Add Repository')).toBeVisible();
});

test('clicking seed box shows seed board', async ({ page }) => {
  await waitForApp(page);
  await page.locator('button', { hasText: 'Seed Box' }).click();
  await expect(page.locator('h1', { hasText: 'Seed Box' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'New Idea' })).toBeVisible();
});

test('seed box shows empty state when convex is connected', async ({
  page,
}) => {
  await waitForApp(page);
  await page.locator('button', { hasText: 'Seed Box' }).click();
  // Empty state only renders after Convex query resolves (seeds === [])
  // With no Convex, the board stays in loading. Check with a generous timeout.
  const noSeeds = page.locator('text=No seeds yet');
  const newIdea = page.locator('button', { hasText: 'New Idea' });
  // At minimum, the header and New Idea button should be visible
  await expect(newIdea).toBeVisible();
  // Empty state depends on Convex — skip assertion if not connected
  if (await noSeeds.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expect(
      page.locator('button', { hasText: 'Add your first idea' }),
    ).toBeVisible();
  }
});

test('clicking all tasks returns to kanban board', async ({ page }) => {
  await waitForApp(page);
  await page.locator('button', { hasText: 'Seed Box' }).click();
  await expect(page.locator('h1', { hasText: 'Seed Box' })).toBeVisible();

  await page.locator('button', { hasText: 'All Tasks' }).click();
  // View transition may be slow on CI — wait for the kanban board to mount
  await expect(page.locator('h1', { hasText: 'All Tasks' })).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator('text=To Do')).toBeVisible();
});

test('seed box new idea inline form appears', async ({ page }) => {
  await waitForApp(page);
  await page.locator('button', { hasText: 'Seed Box' }).click();
  // Wait for seed board to fully mount before interacting
  await expect(page.locator('button', { hasText: 'New Idea' })).toBeVisible();
  await page.locator('button', { hasText: 'New Idea' }).click();
  await expect(
    page.locator('input[placeholder="What\'s the idea?"]'),
  ).toBeVisible({ timeout: 10000 });
});

test('kanban columns show column headers with task counts', async ({
  page,
}) => {
  await waitForApp(page);
  // Each visible column should have a count badge (showing 0)
  for (const label of ['To Do', 'In Progress', 'Review', 'Done']) {
    const column = page.locator('[role="group"]', {
      hasText: label,
    });
    await expect(column).toBeVisible();
    // Count badge shows 0
    await expect(column.locator('text=0')).toBeVisible();
  }
});

test('collapsed backlog has dashed border styling', async ({ page }) => {
  await waitForApp(page);
  const collapsed = page.locator('button', { hasText: 'Backlog' });
  await expect(collapsed).toBeVisible();
  // The collapsed button should have border-dashed class
  await expect(collapsed).toHaveClass(/border-dashed/);
});

test('archive button is visible in header', async ({ page }) => {
  await waitForApp(page);
  const archiveButton = page.locator('button', { hasText: 'Archive' });
  await expect(archiveButton).toBeVisible();
});

test('sidebar and kanban headers have the same height', async ({ page }) => {
  await waitForApp(page);
  const sidebarHeader = page.getByTestId('sidebar-header');
  const kanbanHeader = page.getByTestId('kanban-header');
  const sidebarBox = await sidebarHeader.boundingBox();
  const kanbanBox = await kanbanHeader.boundingBox();
  expect(sidebarBox).not.toBeNull();
  expect(kanbanBox).not.toBeNull();
  expect(sidebarBox?.height).toBe(kanbanBox?.height);
});
