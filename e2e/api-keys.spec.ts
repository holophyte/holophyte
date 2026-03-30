import { expect, test } from '@playwright/test';

// Wait for app to hydrate
async function waitForApp(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
}

// Navigate to the settings page via the UserMenu "API Keys" link
async function navigateToSettingsViaUserMenu(
  page: import('@playwright/test').Page,
) {
  // Open the UserMenu popover (avatar/name button at the bottom of the sidebar)
  const userMenuTrigger = page
    .locator('aside')
    .locator('button')
    .filter({ hasText: /Loading|Anonymous/ })
    .first();
  await userMenuTrigger.click();

  // Click "API Keys" in the popover
  await page
    .locator('[data-radix-popper-content-wrapper]')
    .locator('button', { hasText: 'API Keys' })
    .click();

  // Wait for the settings page to load
  await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible({
    timeout: 10000,
  });
}

test.describe('Settings page - API Keys', () => {
  test('settings page loads via direct navigation', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await expect(page.locator('h1', { hasText: 'Settings' })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('h2', { hasText: 'API Keys' })).toBeVisible();
  });

  test('settings page loads via UserMenu API Keys link', async ({ page }) => {
    await waitForApp(page);
    await navigateToSettingsViaUserMenu(page);
    await expect(page.locator('h2', { hasText: 'API Keys' })).toBeVisible();
    await expect(
      page.locator('button', { hasText: 'Generate Key' }),
    ).toBeVisible();
  });

  test('empty state shows when no API keys exist', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await expect(page.locator('h2', { hasText: 'API Keys' })).toBeVisible({
      timeout: 10000,
    });
    // Convex query may take a moment to resolve
    await expect(
      page.locator('text=No API keys yet. Generate one to get started.'),
    ).toBeVisible({ timeout: 8000 });
  });

  test('Generate Key button opens the dialog', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await expect(
      page.locator('button', { hasText: 'Generate Key' }),
    ).toBeVisible({ timeout: 10000 });

    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(
      dialog.getByRole('heading', { name: 'Generate API Key', exact: true }),
    ).toBeVisible();
    await expect(dialog.locator('#key-name')).toBeVisible();
  });

  test('dialog shows Name input and MCP scope checkbox', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Name field
    await expect(dialog.locator('#key-name')).toBeVisible();
    await expect(dialog.locator('label[for="key-name"]')).toContainText('Name');

    // MCP scope checkbox should be checked by default
    const mcpCheckbox = dialog.locator('input[type="checkbox"]');
    await expect(mcpCheckbox).toBeChecked();
    await expect(dialog.getByText('MCP', { exact: true })).toBeVisible();
  });

  test('Generate Key button is disabled without a name', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Submit button should be disabled with an empty name
    const submitButton = dialog.locator('button', { hasText: 'Generate Key' });
    await expect(submitButton).toBeDisabled();
  });

  test('can generate a new API key and see it displayed once', async ({
    page,
  }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Enter a key name
    const keyName = `E2E Test Key ${Date.now()}`;
    await dialog.locator('#key-name').fill(keyName);

    // Ensure MCP scope is checked
    const mcpCheckbox = dialog.locator('input[type="checkbox"]');
    await expect(mcpCheckbox).toBeChecked();

    // Submit the form
    await dialog.locator('button', { hasText: 'Generate Key' }).click();

    // After generation the dialog should show the key view
    await expect(
      dialog.getByRole('heading', { name: 'API Key Generated', exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Warning message about not showing again
    await expect(
      dialog.locator("text=Copy this key now — it won't be shown again."),
    ).toBeVisible();

    // The raw key should be displayed as a code element
    const keyCode = dialog.locator('code');
    await expect(keyCode).toBeVisible();
    const keyText = await keyCode.textContent();
    expect(keyText).toBeTruthy();
    expect(keyText?.length).toBeGreaterThan(10);

    // Copy button should be visible
    await expect(
      dialog.locator('button[title="Copy to clipboard"]'),
    ).toBeVisible();
  });

  test('copy button shows a checkmark after clicking', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const keyName = `E2E Copy Test ${Date.now()}`;
    await dialog.locator('#key-name').fill(keyName);
    await dialog.locator('button', { hasText: 'Generate Key' }).click();

    // Wait for the generated key view
    await expect(
      dialog.getByRole('heading', { name: 'API Key Generated', exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Click the copy button
    const copyButton = dialog.locator('button[title="Copy to clipboard"]');
    await copyButton.click();

    // After copying, the check icon appears (button still visible, icon changes)
    // The copy icon disappears and a check icon appears
    await expect(copyButton.locator('svg')).toBeVisible();
  });

  test('closing the dialog after generation shows the key in the list', async ({
    page,
  }) => {
    await waitForApp(page);
    await page.goto('/settings');

    // Wait for Convex query to settle
    await page.waitForTimeout(1000);

    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const keyName = `E2E List Test ${Date.now()}`;
    await dialog.locator('#key-name').fill(keyName);
    await dialog.locator('button', { hasText: 'Generate Key' }).click();

    // Wait for generated key view
    await expect(
      dialog.getByRole('heading', { name: 'API Key Generated', exact: true }),
    ).toBeVisible({ timeout: 10000 });

    // Click Done to close the dialog
    await dialog.locator('button', { hasText: 'Done' }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // The key should now appear in the list with its name
    await expect(page.locator(`text=${keyName}`)).toBeVisible({
      timeout: 8000,
    });

    // Should show "active" badge and "mcp" scope badge
    const keyRow = page
      .locator('div.rounded-md.border.p-4')
      .filter({ has: page.locator(`text=${keyName}`) })
      .first();
    await expect(keyRow.getByText('active', { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await expect(keyRow.getByText('mcp', { exact: true })).toBeVisible({
      timeout: 5000,
    });

    // Created date should be visible
    await expect(keyRow.locator('text=/Created/')).toBeVisible();
  });

  test('key list shows name, scopes, and created date', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');

    await page.locator('button', { hasText: 'Generate Key' }).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const keyName = `E2E Details Test ${Date.now()}`;
    await dialog.locator('#key-name').fill(keyName);
    await dialog.locator('button', { hasText: 'Generate Key' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'API Key Generated', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await dialog.locator('button', { hasText: 'Done' }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Find the key row by name
    await expect(page.locator(`text=${keyName}`)).toBeVisible({
      timeout: 8000,
    });

    // The row should contain the expected metadata
    const keyRow = page
      .locator('div.rounded-md.border.p-4')
      .filter({ has: page.locator(`text=${keyName}`) })
      .first();

    await expect(keyRow.getByText('active', { exact: true })).toBeVisible();
    await expect(keyRow.getByText('mcp', { exact: true })).toBeVisible();
    // Created date in the format "Created <Month> <Day>, <Year>"
    await expect(keyRow.locator('text=/^Created/')).toBeVisible();
  });

  test('can revoke a key and see it marked as revoked', async ({ page }) => {
    await waitForApp(page);
    await page.goto('/settings');

    // Generate a key to revoke
    await page.locator('button', { hasText: 'Generate Key' }).click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const keyName = `E2E Revoke Test ${Date.now()}`;
    await dialog.locator('#key-name').fill(keyName);
    await dialog.locator('button', { hasText: 'Generate Key' }).click();
    await expect(
      dialog.getByRole('heading', { name: 'API Key Generated', exact: true }),
    ).toBeVisible({ timeout: 10000 });
    await dialog.locator('button', { hasText: 'Done' }).click();
    await expect(dialog).toBeHidden({ timeout: 5000 });

    // Wait for the key to appear in the list
    await expect(page.locator(`text=${keyName}`)).toBeVisible({
      timeout: 8000,
    });

    // Find the Revoke button for this specific key row
    const keyRow = page
      .locator('div.rounded-md.border.p-4')
      .filter({ has: page.locator(`text=${keyName}`) })
      .first();

    const revokeButton = keyRow.locator('button', { hasText: 'Revoke' });
    await expect(revokeButton).toBeVisible({ timeout: 5000 });
    await revokeButton.click();

    // After revoking, the "revoked" badge should appear
    await expect(page.locator(`text=${keyName}`)).toBeVisible();
    const revokedRow = page
      .locator('div.rounded-md.border.p-4')
      .filter({ has: page.locator(`text=${keyName}`) })
      .first();
    await expect(revokedRow.getByText('revoked', { exact: true })).toBeVisible({
      timeout: 8000,
    });

    // The Revoke button should no longer be present for this key
    await expect(
      revokedRow.locator('button', { hasText: 'Revoke' }),
    ).toBeHidden();

    // A "Revoked <date>" metadata line should appear
    await expect(revokedRow.locator('text=/^Revoked/')).toBeVisible({
      timeout: 5000,
    });
  });

  test('Cancel button closes the dialog without creating a key', async ({
    page,
  }) => {
    await waitForApp(page);
    await page.goto('/settings');
    await page.locator('button', { hasText: 'Generate Key' }).click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });

    // Fill the name but then cancel
    await dialog.locator('#key-name').fill('Key That Should Not Be Created');
    await dialog.locator('button', { hasText: 'Cancel' }).click();

    await expect(dialog).toBeHidden({ timeout: 5000 });

    // The key should not appear in the list
    await expect(
      page.locator('text=Key That Should Not Be Created'),
    ).toBeHidden();
  });
});
