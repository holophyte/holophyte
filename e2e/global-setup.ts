import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:8081';
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });

    // Navigate — AutoTestAuth auto-signs-up on a fresh database.
    // Wait for an authenticated-only element (sidebar "All Tasks" button)
    // since "Holophyte" text also appears on the sign-in page.
    await page.goto('/');
    await page.waitForSelector('aside button:has-text("All Tasks")', {
      timeout: 30000,
    });

    // Create a temp directory to use as a fake repo
    const repoName = `e2e-${randomUUID().slice(0, 8)}`;
    const repoPath = `/tmp/holophyte-e2e-${repoName}`;
    mkdirSync(repoPath, { recursive: true });

    // Intercept the directory picker API to return our temp dir
    await page.route('**/api/pick-directory', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          path: repoPath,
          name: repoName,
          isGitRepo: true,
        }),
      }),
    );

    // Open Add Repository dialog
    const addButton = page
      .locator('div')
      .filter({ hasText: /^Projects$/ })
      .locator('button');
    await addButton.click();
    await page.waitForSelector('text=Add Repository', { timeout: 5000 });

    // Click the folder picker (intercepted) — icon button with title="Browse..."
    await page.locator('button[title="Browse..."]').click();

    // Wait for the intercepted response to populate the name input
    await page.waitForFunction(
      (name) => {
        const input = document.getElementById(
          'repo-name',
        ) as HTMLInputElement | null;
        return input?.value === name;
      },
      repoName,
      { timeout: 5000 },
    );

    // Submit the form
    await page.locator('button', { hasText: 'Add Repo' }).click();

    // Wait for dialog to close and repo to appear in sidebar
    await page.waitForSelector(`button:has-text("${repoName}")`, {
      timeout: 10000,
    });

    mkdirSync('e2e/.auth', { recursive: true });
    await page.context().storageState({ path: 'e2e/.auth/storage-state.json' });
  } finally {
    await browser.close();
  }
}
