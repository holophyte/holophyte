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

test('new task button is disabled without repo selected', async ({ page }) => {
  await waitForApp(page);
  const button = page.locator('button', { hasText: 'New Task' });
  await expect(button).toBeDisabled();
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
  await expect(page.locator('h1', { hasText: 'All Tasks' })).toBeVisible();
  await expect(page.locator('text=To Do')).toBeVisible();
});

test('seed box new idea inline form appears', async ({ page }) => {
  await waitForApp(page);
  await page.locator('button', { hasText: 'Seed Box' }).click();
  await page.locator('button', { hasText: 'New Idea' }).click();
  await expect(
    page.locator('input[placeholder="What\'s the idea?"]'),
  ).toBeVisible();
});
