import { readFileSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

function parseDevPorts(): Record<string, string> {
  try {
    const content = readFileSync('.dev-ports', 'utf-8');
    const ports: Record<string, string> = {};
    for (const line of content.split('\n')) {
      const match = line.match(/^(\w+)=(.+)$/);
      if (match?.[1] && match[2]) ports[match[1]] = match[2];
    }
    return ports;
  } catch {
    return {};
  }
}

function resolveE2ePort(devPorts: Record<string, string>): number {
  if (process.env.E2E_PORT) return Number(process.env.E2E_PORT);
  const devPort = devPorts.DEV_PORT;
  if (devPort) return Number(devPort) + 1;
  return 8081;
}

const devPorts = parseDevPorts();
const e2ePort = resolveE2ePort(devPorts);

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
    env: {
      ...process.env,
      E2E_TEST: '1',
      PORT: String(e2ePort),
      // Pass Convex URL from .dev-ports so the E2E server connects to the
      // correct local Convex instance (not another worktree's)
      ...(devPorts.CONVEX_CLOUD_PORT && {
        CONVEX_URL: `http://127.0.0.1:${devPorts.CONVEX_CLOUD_PORT}`,
      }),
    },
  },
});
