/**
 * Adapter registry — one HarnessAdapter per HarnessId.
 */

import type { HarnessAdapter, HarnessId, HarnessInfo } from '../types';
import { ClaudeAdapter } from './claude';
import { CodexAdapter } from './codex';
import { FakeAdapter } from './fake';
import { stubAdapter } from './stubs';

export const adapters: Record<HarnessId, HarnessAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  fake: new FakeAdapter(),
  cursor: stubAdapter('cursor'),
  devin: stubAdapter('devin'),
};

/** stable display order for the new-session picker */
const ORDER: HarnessId[] = ['claude', 'codex', 'fake', 'cursor', 'devin'];

export async function harnessInfos(): Promise<HarnessInfo[]> {
  return Promise.all(
    ORDER.map(async (id) => ({
      id,
      configured: await adapters[id].configured(),
    })),
  );
}
