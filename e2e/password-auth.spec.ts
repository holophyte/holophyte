import { expect, test } from '@playwright/test';

// These tests run in the 'password-auth' project with a fresh browser context
// (no stored auth state), so the sign-in page renders with the password form.
// Each test runs serially because sign-up mutates server state.
test.describe.configure({ mode: 'serial' });

// Override the config to disable E2E auto-auth so the sign-in page renders
// instead of being bypassed by AutoAnonymousAuth.
async function gotoSignIn(page: import('@playwright/test').Page) {
  await page.route('**/config.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    // Flip e2eTest to false so AutoAnonymousAuth doesn't fire
    const patched = body.replace('"e2eTest":true', '"e2eTest":false');
    if (patched === body) {
      throw new Error(
        'gotoSignIn: config patch failed — "e2eTest":true not found in /config.js response',
      );
    }
    await route.fulfill({ response, body: patched });
  });
  await page.goto('/');
  await page.waitForSelector('text=Sign in to manage your projects', {
    timeout: 15000,
  });
}

test.describe('password auth sign-in page', () => {
  test('shows OAuth buttons and password form', async ({ page }) => {
    await gotoSignIn(page);
    await expect(
      page.getByRole('button', { name: 'Continue with GitHub' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Continue with Google' }),
    ).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('toggles between sign-in and sign-up modes', async ({ page }) => {
    await gotoSignIn(page);

    // Default mode is sign-in
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Don't have an account?")).toBeVisible();

    // Switch to sign-up
    await page.getByRole('button', { name: 'Create one' }).click();
    await expect(
      page.getByRole('button', { name: 'Create account' }),
    ).toBeVisible();
    await expect(page.getByText('Already have an account?')).toBeVisible();

    // Switch back to sign-in
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
  });

  test('sign-in with wrong password shows error', async ({ page }) => {
    await gotoSignIn(page);

    await page.getByLabel('Email').fill('nonexistent@holophyte.test');
    await page.getByLabel('Password').fill('wrongpassword1');
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Should show a user-friendly error
    await expect(page.getByText('Incorrect email or password.')).toBeVisible({
      timeout: 10000,
    });
  });

  test('sign-up creates account and signs in', async ({ page }) => {
    await gotoSignIn(page);

    // Switch to sign-up mode
    await page.getByRole('button', { name: 'Create one' }).click();

    // Fill in credentials
    await page.getByLabel('Email').fill('e2e-test@holophyte.test');
    await page.getByLabel('Password').fill('testpassword123');
    await page.getByRole('button', { name: 'Create account' }).click();

    // Wait for auth to complete — should show the authenticated layout
    await expect(page.locator('text=Holophyte').first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: 'All Tasks' })).toBeVisible({
      timeout: 10000,
    });
  });
});
