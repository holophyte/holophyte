import { expect, test } from '@playwright/test';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
}

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

async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  prompt: string,
) {
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ hasText: 'To Do' });
  await todoColumn.locator('button', { hasText: 'Add' }).click();

  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.locator('#task-title').fill(title);
  await page.locator('#task-prompt').fill(prompt);
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
}

test.describe('Task Detail Panel', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('Escape closes the panel', async ({ page }) => {
    await createTask(page, 'E2E Escape Close', 'prompt');
    await page
      .locator('[data-task-id]', { hasText: 'E2E Escape Close' })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeHidden({ timeout: 2000 });
    await expect(page).toHaveURL(/\/repos\/[^/]+$/);
  });

  test('Escape does not close panel when title input is focused', async ({
    page,
  }) => {
    await createTask(page, 'E2E Escape Focus', 'prompt');
    await page
      .locator('[data-task-id]', { hasText: 'E2E Escape Focus' })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    const taskUrl = page.url();

    await page.locator('#detail-title').click();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(taskUrl);
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
  });

  test('Escape does not close panel when focused inside a label picker portal', async ({
    page,
  }) => {
    await createTask(page, 'E2E Escape Portal', 'prompt');
    await page
      .locator('[data-task-id]', { hasText: 'E2E Escape Portal' })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    const taskUrl = page.url();

    // Open the label picker popover (portals outside panelRef via data-radix-popper-content-wrapper)
    await page.locator('button', { hasText: 'Tags' }).click();
    await page.locator('input[placeholder="Tag name"]').first().click();
    await page.keyboard.press('Escape');

    await expect(page).toHaveURL(taskUrl);
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
  });

  test('clicking outside closes the panel', async ({ page }) => {
    await createTask(page, 'E2E Outside Click', 'prompt');
    await page
      .locator('[data-task-id]', { hasText: 'E2E Outside Click' })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();

    // Click on the kanban board background (outside the panel)
    await page
      .locator('main')
      .click({ position: { x: 100, y: 100 }, force: true });

    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeHidden({ timeout: 2000 });
    await expect(page).toHaveURL(/\/repos\/[^/]+$/);
  });

  test('clicking inside a label picker portal does not close the panel', async ({
    page,
  }) => {
    await createTask(page, 'E2E Label Picker Portal Click', 'prompt');
    await page
      .locator('[data-task-id]', { hasText: 'E2E Label Picker Portal Click' })
      .first()
      .click();
    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    const taskUrl = page.url();

    // Open the label picker popover — portal renders via data-radix-popper-content-wrapper outside panelRef
    await page.locator('button', { hasText: 'Tags' }).click();
    await expect(page.locator('input[placeholder="Tag name"]')).toBeVisible({
      timeout: 5000,
    });

    // Simulate mousedown inside the portal (outside panelRef in the DOM)
    await page.locator('input[placeholder="Tag name"]').click();

    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    await expect(page).toHaveURL(taskUrl);
  });

  test('clicking another task card keeps the panel open and updates the route', async ({
    page,
  }) => {
    const firstTitle = 'E2E Detail Panel First';
    const secondTitle = 'E2E Detail Panel Second';
    const firstPrompt = 'First panel prompt';
    const secondPrompt = 'Second panel prompt';

    await createTask(page, firstTitle, firstPrompt);
    await createTask(page, secondTitle, secondPrompt);

    await page
      .locator('[data-task-id]', { hasText: firstTitle })
      .first()
      .click();

    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    await expect(page.locator('#detail-title')).toHaveValue(firstTitle);
    await expect(page).toHaveURL(/\/repos\/[^/]+\/tasks\/[^/]+$/);

    const firstUrl = page.url();

    await page
      .locator('[data-task-id]', { hasText: secondTitle })
      .first()
      .click();

    await expect(
      page.getByRole('heading', { name: 'Task Details' }),
    ).toBeVisible();
    await expect(page.locator('#detail-title')).toHaveValue(secondTitle);
    await expect(page.locator('#detail-prompt')).toHaveValue(secondPrompt);
    await expect(page).toHaveURL(/\/repos\/[^/]+\/tasks\/[^/]+$/);
    await expect.poll(() => page.url()).not.toBe(firstUrl);
  });
});
