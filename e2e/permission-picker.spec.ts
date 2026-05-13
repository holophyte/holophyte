import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

async function selectRepo(page: import('@playwright/test').Page) {
  const repoButton = page
    .locator('aside[aria-label="Navigation"]')
    .locator('button')
    .filter({ hasNotText: /All Tasks|Seed Box|Projects|Add|Command/ })
    .filter({ hasText: /e2e-/ })
    .first();
  await repoButton.click();
  await expect(
    page.getByRole('heading', { name: 'To Do', exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  prompt?: string,
) {
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ has: page.getByRole('heading', { name: 'To Do', exact: true }) });
  await todoColumn.locator('button', { hasText: 'Add' }).click();
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.locator('#task-title').fill(title);
  if (prompt) await page.locator('#task-prompt').fill(prompt);
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
}

async function openTaskPage(
  page: import('@playwright/test').Page,
  taskTitle: string,
) {
  const card = page.locator(`[data-task-id]`, { hasText: taskTitle }).first();
  await card.click();
  await page
    .locator(`button[aria-label="Open ${taskTitle} in task page"]`)
    .first()
    .click({ timeout: 5000 });
  await expect(
    page.locator('text=Send a message to start the conversation'),
  ).toBeVisible({ timeout: 10000 });
}

test.describe('PermissionModePicker on launch surface', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('picker is visible on the no-session launch footer', async ({
    page,
  }) => {
    const title = `E2E PermissionPicker ${Date.now()}`;
    await createTask(page, title);
    await openTaskPage(page, title);

    const picker = page.getByRole('combobox', { name: 'Permission mode' });
    await expect(picker).toBeVisible();
    // Claude is the default provider; the per-provider default is 'safe-auto'.
    await expect(picker).toHaveText(/Safe auto/);
  });

  test('selection is persisted to localStorage', async ({ page }) => {
    const title = `E2E PermissionPersist ${Date.now()}`;
    await createTask(page, title);
    await openTaskPage(page, title);

    // Pre-seed localStorage to bypass — equivalent to having previously
    // chosen Bypass for Claude. The picker reads from storage on mount, so
    // we reload to pick up the value.
    await page.evaluate(() => {
      window.localStorage.setItem('holophyte.lastPermission.claude', 'bypass');
    });
    await page.reload();
    await expect(
      page.locator('text=Send a message to start the conversation'),
    ).toBeVisible({ timeout: 10000 });

    const picker = page.getByRole('combobox', { name: 'Permission mode' });
    await expect(picker).toHaveText(/Bypass/);
  });
});
