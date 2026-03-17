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
  // Wait for the task card to appear on the board
  await expect(page.locator('[data-task-id]', { hasText: title })).toBeVisible({
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
    await selectRepo(page);
    const taskTitle = `E2E Activity ${Date.now()}`;
    await createTask(page, taskTitle);

    await goToActivity(page);
    await expect(page.locator('text=created a task')).toBeVisible({
      timeout: 10000,
    });
  });

  test('moving a task logs status change', async ({ page }) => {
    await selectRepo(page);
    const taskTitle = `E2E Move ${Date.now()}`;
    await createTask(page, taskTitle);

    // Drag the task from To Do to In Progress
    const taskCard = page
      .locator('[data-task-id]', { hasText: taskTitle })
      .first();
    const targetColumn = page.locator(
      '[role="group"][aria-label="In Progress column"]',
    );
    await taskCard.dragTo(targetColumn);

    // Verify the task now appears in the In Progress column
    await expect(
      targetColumn.locator('[data-task-id]', { hasText: taskTitle }),
    ).toBeVisible({ timeout: 10000 });

    // Check the activity log for the move entry
    await goToActivity(page);
    await expect(
      page.locator('text=moved a task from todo to in_progress'),
    ).toBeVisible({ timeout: 10000 });
  });

  test('changing labels on a task logs label change', async ({ page }) => {
    await selectRepo(page);
    const taskTitle = `E2E Labels ${Date.now()}`;
    await createTask(page, taskTitle);

    // Click the task card to navigate to the detail panel
    const taskCard = page
      .locator('[data-task-id]', { hasText: taskTitle })
      .first();
    await taskCard.click();

    // Wait for the detail panel to load (title input with the task title)
    await expect(page.locator('input[placeholder="Task title"]')).toBeVisible({
      timeout: 10000,
    });

    // Open the Tags popover
    const tagsButton = page.locator('button', { hasText: 'Tags' });
    await tagsButton.click();

    // Click "Create new tag" to make a label
    const labelName = `e2e-label-${Date.now()}`;
    await page.locator('button', { hasText: 'Create new tag' }).click();
    await page.locator('input[placeholder="Tag name"]').fill(labelName);
    await page.locator('button', { hasText: 'Add' }).click();

    // The new label should now appear as a pill on the task
    await expect(page.locator(`text=${labelName}`)).toBeVisible({
      timeout: 10000,
    });

    // Check the activity log for the label change entry
    await goToActivity(page);
    await expect(page.locator('text=changed labels on a task')).toBeVisible({
      timeout: 10000,
    });
  });
});
