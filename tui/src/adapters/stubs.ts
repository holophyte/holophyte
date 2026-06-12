/**
 * Post-v1 harness stubs — shown grayed (not hidden) in the new-session
 * picker. Adding real support must require only a new adapter file.
 */

import type { HarnessAdapter } from '../types';

export function stubAdapter(id: 'cursor' | 'devin'): HarnessAdapter {
  return {
    id,
    capabilities: { remotePermission: false, questionText: false },
    configured: () => false,
    spawnCommand(): string[] {
      throw new Error(`${id} is not configured (post-v1)`);
    },
  };
}
