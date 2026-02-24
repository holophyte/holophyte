import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

function resolveE2ePort(): number {
  if (process.env.E2E_PORT) return Number(process.env.E2E_PORT);
  try {
    const devPorts = readFileSync('.dev-ports', 'utf-8');
    const match = devPorts.match(/^DEV_PORT=(\d+)/m);
    if (match?.[1]) return Number(match[1]) + 1;
  } catch {}
  return 8081;
}

const e2ePort = resolveE2ePort();

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: `http://localhost:${e2ePort}`,
    trace: 'on-first-retry',
    storageState: 'e2e/.auth/storage-state.json',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  // E2E server runs on DEV_PORT+1 so it doesn't collide with the dev server.
  // Override with E2E_PORT env var if needed.
  webServer: {
    command: 'bun run src/server.ts',
    url: `http://localhost:${e2ePort}/`,
    reuseExistingServer: false,
    env: { ...process.env, E2E_TEST: '1', PORT: String(e2ePort) },
  },
});
