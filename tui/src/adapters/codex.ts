/**
 * Codex CLI adapter — per-invocation hook injection via `-c` TOML overrides.
 * Requires codex >= 0.139: `-c hooks.*` injection is silently dead in older
 * releases (live-verified, docs/hooks-research.md LIVE-TEST RESULTS) — an
 * 0.137 spawn sits at 'starting…' forever with zero signal, so configured()
 * version-gates and the picker grays the harness out instead.
 * See docs/hooks-research.md: `-c` overrides are in-memory only and MERGE
 * with file config. NEVER touch `notify` or any global codex config — Ko's
 * global notify is claimed by Codex Computer Use (hard requirement).
 */

import { spawnSync } from 'node:child_process';
import type { HarnessAdapter, Session } from '../types';
import { hookCommand } from './claude';

/** PermissionRequest hook timeout (seconds) — above the 90s daemon hold. */
const PERMISSION_HOOK_TIMEOUT_SEC = 150;

/** First release where `-c hooks.*` injection actually fires. */
const MIN_CODEX_VERSION = [0, 139, 0] as const;

/**
 * True when `codex --version` output (e.g. 'codex-cli 0.139.0') is at least
 * MIN_CODEX_VERSION. null / unparseable output → false.
 */
export function codexVersionSupported(versionOutput: string | null): boolean {
  const match = versionOutput?.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return false;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])];
  for (let i = 0; i < MIN_CODEX_VERSION.length; i++) {
    const actual = parts[i] ?? 0;
    const min = MIN_CODEX_VERSION[i] ?? 0;
    if (actual !== min) return actual > min;
  }
  return true;
}

function probeCodexVersion(): string | null {
  const result = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout : null;
}

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

  constructor(
    opts: {
      configured?: () => boolean;
      codexVersion?: () => string | null;
    } = {},
  ) {
    const codexVersion = opts.codexVersion ?? probeCodexVersion;
    this.isConfigured =
      opts.configured ?? (() => codexVersionSupported(codexVersion()));
  }

  configured(): boolean {
    return this.isConfigured();
  }

  private hookFlags(session: Session): string[] {
    const command = hookCommand('codex', session.id);
    return [
      '-C',
      session.cwd,
      // The update dialog otherwise blocks session startup.
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      codexHookOverride('UserPromptSubmit', command),
      '-c',
      codexHookOverride('PreToolUse', command),
      '-c',
      codexHookOverride(
        'PermissionRequest',
        command,
        PERMISSION_HOOK_TIMEOUT_SEC,
      ),
      '-c',
      codexHookOverride('Stop', command),
      '-c',
      codexHookOverride('SessionStart', command),
      // Required: non-managed injected hooks are otherwise skipped until
      // interactively trusted via /hooks.
      '--dangerously-bypass-hook-trust',
    ];
  }

  async spawnCommand(session: Session): Promise<string[]> {
    return ['codex', ...this.hookFlags(session)];
  }

  // Globals-before-subcommand order, parse-verified against codex 0.139.0
  // (docs/hooks-research.md, codex resume flag placement).
  async resumeCommand(session: Session): Promise<string[]> {
    if (session.harnessSessionId === undefined) {
      throw new Error('codex resume requires a captured conversation id');
    }
    return [
      'codex',
      ...this.hookFlags(session),
      'resume',
      session.harnessSessionId,
    ];
  }
}
