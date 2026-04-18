import type { Page } from '@playwright/test';

/**
 * Navigate to the app and wait for it to be fully authenticated.
 *
 * Waits for `aside button:has-text("All Tasks")` — an element that only
 * appears after Convex auth is ready and the authenticated layout has mounted.
 * Unlike `text=Holophyte`, this selector is NOT present on the sign-in page,
 * so it correctly gates on auth completion rather than the initial page render.
 *
 * Each test starts with a fresh browser context (no stored tokens), so
 * AutoTestAuth signs in with password credentials on every navigation.
 */
export async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  // 10s: auth handshake + Bun bundler cold-cache under parallel workers can be
  // slow on the first hit, but a 30s timeout just hid regressions behind long
  // retries. If the authenticated gate isn't visible in 10s, something is
  // genuinely wrong.
  await page.waitForSelector('aside button:has-text("All Tasks")', {
    timeout: 10000,
  });
}
