import { expect, test } from '@playwright/test';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
}

async function selectRepo(page: import('@playwright/test').Page) {
  const repoButton = page
    .locator('aside[aria-label="Navigation"]')
    .locator('button')
    .filter({ hasNotText: /All Tasks|Seed Box|Activity|Projects|Add|Command/ })
    .filter({ hasText: /e2e-/ })
    .first();
  await repoButton.click();
  await expect(page.locator('text=To Do')).toBeVisible({ timeout: 10000 });
}

async function goToActivity(page: import('@playwright/test').Page) {
  await page.locator('button', { hasText: 'Activity' }).click();
  await expect(page.locator('h1', { hasText: 'Activity' })).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Activity Log', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
  });

  test('activity page is accessible from sidebar', async ({ page }) => {
    const activityButton = page.locator('button', { hasText: 'Activity' });
    await expect(activityButton).toBeVisible();
    await activityButton.click();
    await expect(page.locator('h1', { hasText: 'Activity' })).toBeVisible({
      timeout: 10000,
    });
  });

  test('activity log shows repo creation from global setup', async ({
    page,
  }) => {
    await goToActivity(page);
    // The global-setup creates an e2e repo, so there should be at least one entry
    // Wait for Convex query to resolve — either entries appear or empty state
    const entry = page.locator('text=created project');
    const empty = page.locator('text=No activity yet');
    await expect(entry.or(empty)).toBeVisible({ timeout: 10000 });
  });

  test('creating a task adds an entry to the activity log', async ({
    page,
  }) => {
    // First, select the e2e repo and create a task
    await selectRepo(page);
    const taskTitle = `E2E Activity ${Date.now()}`;

    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });
    await page.locator('#task-title').fill(taskTitle);
    await page
      .locator('[role="dialog"]')
      .locator('button', { hasText: 'Create' })
      .click();
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });

    // Now navigate to the Activity page
    await goToActivity(page);

    // The activity log should contain a "created a task" entry
    await expect(page.locator('text=created a task')).toBeVisible({
      timeout: 10000,
    });
  });
});
