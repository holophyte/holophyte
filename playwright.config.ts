import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:8081',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // E2E tests expect `bun run convex:dev` to be running separately.
  // Uses port 8081 (not 8080) so the dev server can run alongside e2e tests
  // without being reused — the e2e server needs E2E_TEST=1 to bypass auth.
  webServer: {
    command: 'bun run src/server.ts',
    url: 'http://localhost:8081/',
    reuseExistingServer: false,
    env: { ...process.env, E2E_TEST: '1', PORT: '8081' },
  },
});
