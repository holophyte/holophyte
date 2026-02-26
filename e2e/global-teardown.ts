import { readdirSync, rmSync } from 'node:fs';

export default async function globalTeardown() {
  // Clean up temp directories created by global-setup
  try {
    const tmpEntries = readdirSync('/tmp');
    for (const entry of tmpEntries) {
      if (entry.startsWith('holophyte-e2e-')) {
        rmSync(`/tmp/${entry}`, { recursive: true, force: true });
      }
    }
  } catch {
    // /tmp cleanup is best-effort
  }
}
