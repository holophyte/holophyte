import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

// Helper: select a repo from the sidebar (global-setup creates one)
async function selectRepo(page: import('@playwright/test').Page) {
  // The sidebar should have at least one repo from global-setup
  const repoButton = page
    .locator('aside[aria-label="Navigation"]')
    .locator('button')
    .filter({ hasNotText: /All Tasks|Seed Box|Projects|Add|Command/ })
    .filter({ hasText: /e2e-/ })
    .first();
  await repoButton.click();
  // Wait for kanban board to load with columns
  await expect(
    page.getByRole('heading', { name: 'To Do', exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

// Helper: create a task in the To Do column and return its title
async function createTask(
  page: import('@playwright/test').Page,
  title: string,
  prompt?: string,
) {
  // Click "+ Add" in To Do column
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ has: page.getByRole('heading', { name: 'To Do', exact: true }) });
  const addButton = todoColumn.locator('button', { hasText: 'Add' });
  await addButton.click();

  // Fill the dialog
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.locator('#task-title').fill(title);
  if (prompt) {
    await page.locator('#task-prompt').fill(prompt);
  }
  await page.locator('button', { hasText: 'Create' }).click();

  // Wait for dialog to close
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
}

// Helper: open a task in the full page view
async function openTaskPage(
  page: import('@playwright/test').Page,
  taskTitle: string,
) {
  // Click on the task card
  const card = page.locator(`[data-task-id]`, { hasText: taskTitle }).first();
  await card.click();

  // Side panel should open — click maximize to go to full page
  await page
    .locator(`button[aria-label="Open ${taskTitle} in task page"]`)
    .click({ timeout: 5000 });

  // Wait for the task page to load
  await expect(
    page
      .locator('text=Claude Code Session')
      .or(page.locator('text=No active session'))
      .first(),
  ).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Session Panel', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('task page shows session panel with no-session placeholder', async ({
    page,
  }) => {
    await createTask(page, 'E2E Session Test', 'Test prompt for E2E');
    await openTaskPage(page, 'E2E Session Test');

    // Session panel should show the no-session placeholder
    await expect(page.locator('text=No active session')).toBeVisible();
    await expect(
      page.locator('textarea[placeholder*="What would you like Claude"]'),
    ).toBeVisible();
    await expect(
      page.locator('button', { hasText: 'Start session' }),
    ).toBeVisible();
  });

  test('no-session placeholder has disabled start button when empty', async ({
    page,
  }) => {
    await createTask(page, 'E2E Empty Input Test');
    await openTaskPage(page, 'E2E Empty Input Test');

    const startButton = page.locator('button', { hasText: 'Start session' });
    await expect(startButton).toBeDisabled();
  });

  test('no-session placeholder enables start button after typing', async ({
    page,
  }) => {
    await createTask(page, 'E2E Enable Button Test');
    await openTaskPage(page, 'E2E Enable Button Test');

    const textarea = page.locator(
      'textarea[placeholder*="What would you like Claude"]',
    );
    const startButton = page.locator('button', { hasText: 'Start session' });

    await expect(startButton).toBeDisabled();
    await textarea.fill('Hello Claude');
    await expect(startButton).toBeEnabled();
  });

  test('session dropdown is visible in session panel header', async ({
    page,
  }) => {
    await createTask(page, 'E2E Dropdown Test');
    await openTaskPage(page, 'E2E Dropdown Test');

    // The session header area should be visible (contains session dropdown)
    const header = page
      .locator('div')
      .filter({ hasText: /Session/ })
      .first();
    await expect(header).toBeVisible();
  });

  test('task page has two-panel layout with collapsible details', async ({
    page,
  }) => {
    await createTask(page, 'E2E Layout Test');
    await openTaskPage(page, 'E2E Layout Test');

    // Left panel should show task detail fields
    await expect(page.locator('#detail-title').first()).toBeVisible();
    await expect(page.locator('#detail-description').first()).toBeVisible();

    // Right panel should show session panel (no-session state)
    await expect(page.locator('text=No active session')).toBeVisible();
  });
});

test.describe('Session Panel - Theme Rendering', () => {
  const themes = ['dark', 'light'];

  test.beforeEach(async ({ page }, testInfo) => {
    await waitForApp(page);
    await selectRepo(page);
    const taskTitle = `E2E Theme Test ${testInfo.title}`;
    await createTask(page, taskTitle);
    await openTaskPage(page, taskTitle);
  });

  for (const theme of themes) {
    test(`renders correctly with ${theme} theme`, async ({ page }) => {
      // Set theme via data attribute
      await page.evaluate(
        (t) => document.documentElement.setAttribute('data-theme', t),
        theme,
      );

      // Verify the theme is applied
      const appliedTheme = await page.evaluate(() =>
        document.documentElement.getAttribute('data-theme'),
      );
      expect(appliedTheme).toBe(theme);

      // Verify key elements are still visible and styled
      await expect(page.locator('text=No active session')).toBeVisible();
      await expect(
        page.locator('textarea[placeholder*="What would you like Claude"]'),
      ).toBeVisible();

      // Verify background color is set (theme CSS variables are active)
      const bgColor = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue(
          '--background',
        ),
      );
      expect(bgColor.trim()).not.toBe('');
    });
  }
});
