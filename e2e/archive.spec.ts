import { expect, test } from '@playwright/test';

// Wait for app to hydrate
async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
}

// Select the e2e repo created by global-setup
async function selectRepo(page: import('@playwright/test').Page) {
  const repoButton = page
    .locator('aside[aria-label="Navigation"]')
    .locator('button')
    .filter({ hasNotText: /All Tasks|Seed Box|Projects|Add|Command/ })
    .filter({ hasText: /e2e-/ })
    .first();
  await repoButton.click();
  await expect(page.locator('text=To Do')).toBeVisible({ timeout: 10000 });
}

// Create a task in the To Do column
async function createTask(
  page: import('@playwright/test').Page,
  title: string,
) {
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ hasText: 'To Do' });
  await todoColumn.locator('button', { hasText: 'Add' }).click();
  await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5000 });
  await page.locator('#task-title').fill(title);
  await page
    .locator('[role="dialog"]')
    .locator('button', { hasText: 'Create' })
    .click();
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
  await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 10000 });
}

test.describe('Archive improvements', () => {
  test('archive button in kanban header shows count badge after archiving', async ({
    page,
  }) => {
    await waitForApp(page);
    await selectRepo(page);

    const taskTitle = `E2E Archive Count ${Date.now()}`;
    await createTask(page, taskTitle);

    // Move task to Done first, then archive all done
    const taskCard = page.locator(`[data-task-id]`, { hasText: taskTitle });
    await taskCard.click();

    // Wait for detail panel
    await expect(page.locator('text=Task Details')).toBeVisible({
      timeout: 5000,
    });

    // Archive from the detail panel
    const archiveButton = page
      .locator('.border-t')
      .locator('button', { hasText: 'Archive' });
    await expect(archiveButton).toBeVisible({ timeout: 5000 });
    await archiveButton.click();

    // Task should disappear from board
    await expect(page.locator(`text=${taskTitle}`)).toBeHidden({
      timeout: 5000,
    });

    // Archive button in header should show a count badge
    const headerArchive = page
      .getByTestId('kanban-header')
      .locator('button', { hasText: 'Archive' });
    const badge = headerArchive.locator('span.rounded-full');
    await expect(badge).toBeVisible({ timeout: 10000 });
    const badgeText = await badge.textContent();
    expect(Number(badgeText)).toBeGreaterThanOrEqual(1);
  });

  test('archive button is visible in task detail panel', async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);

    const taskTitle = `E2E Detail Archive ${Date.now()}`;
    await createTask(page, taskTitle);

    // Click to open detail panel
    const taskCard = page.locator(`[data-task-id]`, { hasText: taskTitle });
    await taskCard.click();
    await expect(page.locator('text=Task Details')).toBeVisible({
      timeout: 5000,
    });

    // Archive button should be in the footer
    const archiveButton = page
      .locator('.border-t')
      .locator('button', { hasText: 'Archive' });
    await expect(archiveButton).toBeVisible();
  });

  test('bulk action bar Move dropdown includes Archive option', async ({
    page,
  }) => {
    await waitForApp(page);
    await selectRepo(page);

    const taskTitle = `E2E Bulk Archive ${Date.now()}`;
    await createTask(page, taskTitle);

    // Select the task via checkbox (Shift+click or use bulk selection)
    const taskCard = page.locator(`[data-task-id]`, { hasText: taskTitle });
    await taskCard.click({ modifiers: ['Shift'] });

    // Bulk action bar should appear
    const bulkBar = page.locator('[role="toolbar"]');
    await expect(bulkBar).toBeVisible({ timeout: 5000 });

    // Click Move button
    await bulkBar.locator('button', { hasText: 'Move' }).click();

    // Archive option should be visible in the popover
    const archiveOption = page.locator(
      '[data-radix-popper-content-wrapper] button',
      { hasText: 'Archive' },
    );
    await expect(archiveOption).toBeVisible({ timeout: 5000 });
  });

  test('archiving from detail panel removes task from board', async ({
    page,
  }) => {
    await waitForApp(page);
    await selectRepo(page);

    const taskTitle = `E2E Archive Remove ${Date.now()}`;
    await createTask(page, taskTitle);

    // Open detail panel
    const taskCard = page.locator(`[data-task-id]`, { hasText: taskTitle });
    await taskCard.click();
    await expect(page.locator('text=Task Details')).toBeVisible({
      timeout: 5000,
    });

    // Click archive
    const archiveButton = page
      .locator('.border-t')
      .locator('button', { hasText: 'Archive' });
    await archiveButton.click();

    // Task should no longer be on the board
    await expect(page.locator(`text=${taskTitle}`)).toBeHidden({
      timeout: 5000,
    });

    // Open archive view — task should be there
    const headerArchive = page
      .getByTestId('kanban-header')
      .locator('button', { hasText: 'Archive' });
    await headerArchive.click();

    await expect(page.locator('h1', { hasText: 'Archive' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({
      timeout: 10000,
    });
  });
});
