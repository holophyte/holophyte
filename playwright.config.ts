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

// Ephemeral Convex ports — set by scripts/test-e2e.sh via e2e-convex.sh.
// Falls back to .dev-ports for running `bunx playwright test` directly.
const convexCloudPort =
  process.env.E2E_CONVEX_CLOUD_PORT ?? devPorts.CONVEX_CLOUD_PORT;
const convexSitePort =
  process.env.E2E_CONVEX_SITE_PORT ?? devPorts.CONVEX_SITE_PORT;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
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
      testIgnore: 'password-auth.spec.ts',
      use: { browserName: 'chromium' },
    },
    {
      name: 'password-auth',
      testMatch: 'password-auth.spec.ts',
      use: {
        browserName: 'chromium',
        // Fresh context — no stored auth, so the sign-in page renders
        storageState: { cookies: [], origins: [] },
      },
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
      ALLOW_PASSWORD_AUTH: '1',
      PORT: String(e2ePort),
      // Point at the ephemeral Convex instance (or dev fallback)
      ...(convexCloudPort && {
        CONVEX_URL: `http://127.0.0.1:${convexCloudPort}`,
      }),
      ...(convexSitePort && {
        CONVEX_SITE_URL: `http://127.0.0.1:${convexSitePort}`,
      }),
      ...(process.env.E2E_INTERNAL_API_SECRET && {
        INTERNAL_API_SECRET: process.env.E2E_INTERNAL_API_SECRET,
      }),
    },
  },
});
