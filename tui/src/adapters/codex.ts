/**
 * Codex CLI adapter — per-invocation hook injection via `-c` TOML overrides.
 * See docs/hooks-research.md: `-c` overrides are in-memory only and MERGE
 * with file config. NEVER touch `notify` or any global codex config — Ko's
 * global notify is claimed by Codex Computer Use (hard requirement).
 */

import { spawnSync } from 'node:child_process';
import type { HarnessAdapter, Session } from '../types';
import { hookCommand } from './claude';

/** PermissionRequest hook timeout (seconds) — above the 90s daemon hold. */
const PERMISSION_HOOK_TIMEOUT_SEC = 150;

/**
 * One `-c` argv value, inline-TOML:
 *   hooks.<event>=[{hooks=[{type="command",command="<escaped>"(,timeout=N)}]}]
 * Backslash and double-quote are escaped for TOML basic strings.
 */
export function codexHookOverride(
  event: string,
  command: string,
  timeoutSec?: number,
): string {
  const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const timeout = timeoutSec === undefined ? '' : `,timeout=${timeoutSec}`;
  return `hooks.${event}=[{hooks=[{type="command",command="${escaped}"${timeout}}]}]`;
}

export class CodexAdapter implements HarnessAdapter {
  readonly id = 'codex' as const;
  // Codex has no AskUserQuestion equivalent → no question text.
  readonly capabilities = { remotePermission: true, questionText: false };

  private readonly isConfigured: () => boolean;

  constructor(opts: { configured?: () => boolean } = {}) {
    this.isConfigured =
      opts.configured ?? (() => spawnSync('which', ['codex']).status === 0);
  }

  configured(): boolean {
    return this.isConfigured();
  }

  async spawnCommand(session: Session): Promise<string[]> {
    const command = hookCommand('codex', session.id);
    return [
      'codex',
      '-C',
      session.cwd,
      '-c',
      codexHookOverride('UserPromptSubmit', command),
      '-c',
      codexHookOverride('PreToolUse', command),
      '-c',
      codexHookOverride('PermissionRequest', command, PERMISSION_HOOK_TIMEOUT_SEC),
      '-c',
      codexHookOverride('Stop', command),
      '-c',
      codexHookOverride('SessionStart', command),
      // Required: non-managed injected hooks are otherwise skipped until
      // interactively trusted via /hooks.
      '--dangerously-bypass-hook-trust',
    ];
  }
}
