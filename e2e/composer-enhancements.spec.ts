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
  prompt?: string,
) {
  const todoColumn = page
    .locator('[role="group"]')
    .filter({ hasText: 'To Do' });
  const addButton = todoColumn.locator('button', { hasText: 'Add' });
  await addButton.click();

  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.locator('#task-title').fill(title);
  if (prompt) {
    await page.locator('#task-prompt').fill(prompt);
  }
  await page.locator('button', { hasText: 'Create' }).click();
  await expect(page.locator('[role="dialog"]')).toBeHidden({ timeout: 5000 });
}

// Open a task in full page view
async function openTaskPage(
  page: import('@playwright/test').Page,
  taskTitle: string,
) {
  const card = page.locator('[data-task-id]', { hasText: taskTitle }).first();
  await card.click();

  await page
    .locator('button[aria-label="Expand to full page"]')
    .click({ timeout: 5000 });

  await expect(
    page
      .locator('text=Claude Code Session')
      .or(page.locator('text=No active session')),
  ).toBeVisible({ timeout: 10000 });
}

// Start a session from the NoSessionPlaceholder — puts it in 'queued' state.
// In E2E the companion is not running so the session stays queued forever,
// which is enough to exercise the composer's active-session branch.
async function startSession(
  page: import('@playwright/test').Page,
  prompt: string,
) {
  const textarea = page.locator(
    'textarea[placeholder*="What would you like Claude"]',
  );
  await textarea.fill(prompt);
  await page.locator('button', { hasText: 'Start session' }).click();

  // Wait for the composer to appear — it replaces the NoSessionPlaceholder
  // once a sessionId exists in the store.
  await expect(
    page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    ),
  ).toBeVisible({ timeout: 10000 });
}

test.describe('Composer Enhancements — active session state', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('composer input is enabled during a queued session', async ({
    page,
  }) => {
    const title = `E2E Composer Enabled ${Date.now()}`;
    await createTask(page, title, 'Initial prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Initial prompt');

    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await expect(input).toBeVisible({ timeout: 5000 });
    await expect(input).toBeEnabled();
  });

  test('stop button is visible when input is empty and session is active', async ({
    page,
  }) => {
    const title = `E2E Stop Button ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    // Input should be empty after starting, so the stop button should show
    const stopButton = page.locator('button[aria-label="Stop session"]');
    await expect(stopButton).toBeVisible({ timeout: 5000 });
  });

  test('stop button has red destructive styling', async ({ page }) => {
    const title = `E2E Stop Styling ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    const stopButton = page.locator('button[aria-label="Stop session"]');
    await expect(stopButton).toBeVisible({ timeout: 5000 });
    await expect(stopButton).toHaveClass(/bg-destructive/);
  });

  test('send button appears when user types in the composer', async ({
    page,
  }) => {
    const title = `E2E Send Button ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    // Initially stop button is visible (empty input + active session)
    await expect(page.locator('button[aria-label="Stop session"]')).toBeVisible(
      { timeout: 5000 },
    );

    // Type in the composer input
    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await input.fill('A follow-up message');

    // Stop button should be gone; send button should appear
    await expect(page.locator('button[aria-label="Stop session"]')).toBeHidden({
      timeout: 3000,
    });
    await expect(page.locator('button[aria-label="Send message"]')).toBeVisible(
      { timeout: 3000 },
    );
  });

  test('send button disappears and stop button returns after clearing input', async ({
    page,
  }) => {
    const title = `E2E Toggle Buttons ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    const stopButton = page.locator('button[aria-label="Stop session"]');
    const sendButton = page.locator('button[aria-label="Send message"]');

    // Type to show send button
    await input.fill('Some text');
    await expect(sendButton).toBeVisible({ timeout: 3000 });
    await expect(stopButton).toBeHidden({ timeout: 3000 });

    // Clear to restore stop button
    await input.fill('');
    await expect(stopButton).toBeVisible({ timeout: 3000 });
    await expect(sendButton).toBeHidden({ timeout: 3000 });
  });

  test('placeholder text changes based on session state', async ({ page }) => {
    const title = `E2E Placeholder ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    // When session is active and input is empty, placeholder mentions stop
    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await expect(input).toBeVisible({ timeout: 5000 });
    const placeholder = await input.getAttribute('placeholder');
    expect(placeholder).toContain('stop');
  });

  test('Enter on empty input triggers stop (session transitions away from queued)', async ({
    page,
  }) => {
    const title = `E2E Enter Stop ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await expect(input).toBeVisible({ timeout: 5000 });

    // Verify stop button is present (empty + active)
    await expect(page.locator('button[aria-label="Stop session"]')).toBeVisible(
      { timeout: 5000 },
    );

    // Press Enter on empty input — should trigger stop
    await input.press('Enter');

    // After stopping, the session should transition away from active.
    // The composer will either show the no-session placeholder or the
    // stopped-state composer without the stop button.
    // Wait for the stop button to disappear (session is no longer active).
    await expect(page.locator('button[aria-label="Stop session"]')).toBeHidden({
      timeout: 10000,
    });
  });
});

test.describe('Composer Enhancements — message history (no session required)', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('up arrow on empty composer does nothing when no history exists', async ({
    page,
  }) => {
    const title = `E2E ArrowUp Empty History ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await expect(input).toBeVisible({ timeout: 5000 });

    // Input is empty, no history — ArrowUp should not change the value
    await input.press('ArrowUp');
    await expect(input).toHaveValue('');
  });

  test('down arrow on empty composer does nothing when not navigating history', async ({
    page,
  }) => {
    const title = `E2E ArrowDown Empty ${Date.now()}`;
    await createTask(page, title, 'Test prompt');
    await openTaskPage(page, title);
    await startSession(page, 'Test prompt');

    const input = page.locator(
      '[aria-label="Follow-up message — press Enter to stop session, or type a message"]',
    );
    await expect(input).toBeVisible({ timeout: 5000 });

    // ArrowDown with no history navigation active — no change
    await input.press('ArrowDown');
    await expect(input).toHaveValue('');
  });
});

test.describe('Composer Enhancements — no session state', () => {
  test.beforeEach(async ({ page }) => {
    await waitForApp(page);
    await selectRepo(page);
  });

  test('no-session placeholder still shows start session button', async ({
    page,
  }) => {
    const title = `E2E No Session Placeholder ${Date.now()}`;
    await createTask(page, title);
    await openTaskPage(page, title);

    // The NoSessionPlaceholder renders a textarea and Start session button
    await expect(
      page.locator('textarea[placeholder*="What would you like Claude"]'),
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.locator('button', { hasText: 'Start session' }),
    ).toBeVisible();
  });

  test('no-session placeholder does not show stop button', async ({ page }) => {
    const title = `E2E No Stop When Idle ${Date.now()}`;
    await createTask(page, title);
    await openTaskPage(page, title);

    // Stop button is only for active sessions — must not appear in no-session state
    await expect(
      page.locator('button[aria-label="Stop session"]'),
    ).toBeHidden();
  });
});
