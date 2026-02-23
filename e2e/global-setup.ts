import { chromium, type FullConfig } from '@playwright/test';

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://localhost:8081';
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL });
  await page.goto('/');
  await page.waitForSelector('text=Holophyte', { timeout: 30000 });
  await page.context().storageState({ path: 'e2e/.auth/storage-state.json' });
  await browser.close();
}
