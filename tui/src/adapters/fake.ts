/**
 * Fake harness adapter — spawns fake-agent.ts, which emits scripted hook
 * events to the daemon. The fast suite and TUI tests run entirely on this
 * (spec.md v1 deliverable).
 */

import { fileURLToPath } from 'node:url';
import { holoHome } from '../paths';
import type { HarnessAdapter, Session } from '../types';

const fakeAgentPath = fileURLToPath(
  new URL('./fake-agent.ts', import.meta.url),
);

export class FakeAdapter implements HarnessAdapter {
  readonly id = 'fake' as const;
  readonly capabilities = { remotePermission: true, questionText: true };

  configured(): boolean {
    return true;
  }

  spawnCommand(session: Session): string[] {
    return [
      process.execPath,
      fakeAgentPath,
      session.id,
      '--home',
      holoHome(),
      ...(process.env.HOLO_FAKE_SCRIPT
        ? ['--script', process.env.HOLO_FAKE_SCRIPT]
        : []),
    ];
  }
}
