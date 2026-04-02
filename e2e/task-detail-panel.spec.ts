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
