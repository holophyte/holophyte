import { expect, test } from '@playwright/test';
import { waitForApp } from './helpers';

// Ensure we are on the All Tasks view (no repo selected)
async function goToAllTasks(page: import('@playwright/test').Page) {
  await page
    .locator('aside')
    .getByRole('button', { name: 'All Tasks' })
    .click();
  await expect(page.locator('h1', { hasText: 'All Tasks' })).toBeVisible({
    timeout: 10000,
  });
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
  await expect(
    page.getByRole('heading', { name: 'To Do', exact: true }),
  ).toBeVisible({ timeout: 10000 });
}

test.describe('All Tasks - Create Task with Repo Picker', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await goToAllTasks(page);
  });

  test('clicking Add opens create dialog with project picker', async ({
    page,
  }) => {
    // Click "+ Add" on the To Do column
    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    const addButton = todoColumn.locator('button', { hasText: 'Add' });
    await addButton.click();

    // Dialog should open
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.locator('text=Create Task')).toBeVisible();

    // Project picker label and trigger should be visible
    await expect(
      page.locator('[role="dialog"]').getByText('Project', { exact: true }),
    ).toBeVisible();
  });

  test('project picker shows available repos', async ({ page }) => {
    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // Click the project picker trigger to open the dropdown
    const pickerTrigger = page
      .locator('[role="dialog"]')
      .locator('button')
      .filter({ hasText: /e2e-|Select a project/ });
    await pickerTrigger.click();

    // The e2e repo from global-setup should appear in the dropdown
    const repoOption = page.locator(
      '[data-radix-popper-content-wrapper] button',
      {
        hasText: /e2e-/,
      },
    );
    await expect(repoOption.first()).toBeVisible({ timeout: 5000 });
  });

  test('can create a task from All Tasks view via repo picker', async ({
    page,
  }) => {
    const taskTitle = `E2E All Tasks Create ${Date.now()}`;

    // Click Add on To Do column
    const todoColumn = page.locator('[role="group"]').filter({
      has: page.getByRole('heading', { name: 'To Do', exact: true }),
    });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // The repo picker should auto-select the only available repo
    // (or last used) — just verify it's not "Select a project..."
    const pickerTrigger = page
      .locator('[role="dialog"]')
      .locator('button')
      .filter({ hasText: /e2e-|Select a project/ });
    const pickerText = await pickerTrigger.textContent();

    // If it says "Select a project...", manually pick the repo
    if (pickerText?.includes('Select a project')) {
      await pickerTrigger.click();
      const repoOption = page.locator(
        '[data-radix-popper-content-wrapper] button',
        { hasText: /e2e-/ },
      );
      await repoOption.first().click();
    }

    // Fill title
    await page.locator('#task-title').fill(taskTitle);

    // Create button should be enabled
    const createButton = page
      .locator('[role="dialog"]')
      .locator('button', { hasText: 'Create' });
    await expect(createButton).toBeEnabled();

    // Submit
    await createButton.click();

    // Dialog should close
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });

    // Task should appear on the board
    await expect(page.locator(`text=${taskTitle}`)).toBeVisible({
      timeout: 10000,
    });
  });

  test('create button is disabled without a title', async ({ page }) => {
    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // Even if a repo is selected, Create should be disabled without a title
    const createButton = page
      .locator('[role="dialog"]')
      .locator('button', { hasText: 'Create' });
    await expect(createButton).toBeDisabled();
  });

  test('repo picker remembers last used repo', async ({ page }) => {
    // First create — pick the repo
    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // Click picker, select the e2e repo
    const pickerTrigger = page
      .locator('[role="dialog"]')
      .locator('button')
      .filter({ hasText: /e2e-|Select a project/ });
    await pickerTrigger.click();
    const repoOption = page.locator(
      '[data-radix-popper-content-wrapper] button',
      { hasText: /e2e-/ },
    );
    const repoName = await repoOption.first().textContent();
    await repoOption.first().click();

    // Fill and submit
    await page.locator('#task-title').fill('E2E Remember Repo Test');
    await page
      .locator('[role="dialog"]')
      .locator('button', { hasText: 'Create' })
      .click();
    await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });

    // Open dialog again — should default to the previously used repo
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // The picker should show the remembered repo name (not "Select a project...")
    const pickerText = await pickerTrigger.textContent();
    expect(pickerText).toContain(repoName?.trim());

    // Cancel to clean up
    await page
      .locator('[role="dialog"]')
      .locator('button', { hasText: 'Cancel' })
      .click();
  });
});

test.describe('Repo-specific view - No repo picker', () => {
  test('create dialog does NOT show project picker when repo is selected', async ({
    page,
  }) => {
    await waitForApp(page);
    await selectRepo(page);

    // Click Add on To Do column
    const todoColumn = page
      .locator('[role="group"]')
      .filter({ hasText: 'To Do' });
    await todoColumn.locator('button', { hasText: 'Add' }).click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({
      timeout: 5000,
    });

    // The "Project" label should NOT be present — repo is fixed
    await expect(
      page.locator('[role="dialog"]').locator('text=Project'),
    ).toBeHidden();
  });
});
