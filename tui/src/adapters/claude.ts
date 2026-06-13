/**
 * Claude Code adapter — spawn-time hook injection via `claude --settings`.
 * See docs/hooks-research.md for the verified hook/settings schema.
 */

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { holoHome, sessionDir, sessionSettingsPath } from '../paths';
import type { HarnessAdapter, Session } from '../types';

const HOOK_EVENTS = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'Notification',
  'Stop',
  'SessionEnd',
] as const;

/**
 * PermissionRequest hook timeout in SECONDS (per-hook `timeout` field).
 * Must exceed the daemon's 90s permission hold so the daemon — not the
 * harness — decides when to release the held connection.
 */
const PERMISSION_HOOK_TIMEOUT_SEC = 150;

/** Single-arg shell quote — claude runs hook commands via a shell. */
function q(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * The shell command injected for every hook:
 *   HOLO_HOME=<home> <bun> <main.ts> <harness> <sessionId>
 * HOLO_HOME is resolved here, in the daemon process — hooks spawned inside
 * tmux inherit the tmux SERVER's environment, so without the prefix a
 * non-default home would make them dial the wrong daemon socket.
 */
export function hookCommand(harness: string, sessionId: string): string {
  const hookMainPath = fileURLToPath(
    new URL('../hook/main.ts', import.meta.url),
  );
  return `HOLO_HOME=${q(holoHome())} ${q(process.execPath)} ${q(hookMainPath)} ${q(harness)} ${q(sessionId)}`;
}

/** Per-session settings object written to ~/.holo/sessions/<id>/settings.json. */
export function buildClaudeSettings(hookCommand: string): object {
  const hooks: Record<string, unknown> = {};
  for (const event of HOOK_EVENTS) {
    hooks[event] = [{ hooks: [{ type: 'command', command: hookCommand }] }];
  }
  hooks.PermissionRequest = [
    {
      hooks: [
        {
          type: 'command',
          command: hookCommand,
          timeout: PERMISSION_HOOK_TIMEOUT_SEC,
        },
      ],
    },
  ];
  return {
    // Kill OS notifications so hooks are the single signal source (spec.md).
    preferredNotifChannel: 'notifications_disabled',
    hooks,
  };
}

export class ClaudeAdapter implements HarnessAdapter {
  readonly id = 'claude' as const;
  readonly capabilities = { remotePermission: true, questionText: true };

  private readonly isConfigured: () => boolean;

  constructor(opts: { configured?: () => boolean } = {}) {
    this.isConfigured =
      opts.configured ?? (() => spawnSync('which', ['claude']).status === 0);
  }

  configured(): boolean {
    return this.isConfigured();
  }

  private writeSettings(sessionId: string): string {
    mkdirSync(sessionDir(sessionId), { recursive: true });
    const settings = buildClaudeSettings(hookCommand('claude', sessionId));
    const settingsPath = sessionSettingsPath(sessionId);
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return settingsPath;
  }

  async spawnCommand(session: Session): Promise<string[]> {
    return [
      'claude',
      '--session-id',
      session.harnessSessionId ?? randomUUID(),
      '--settings',
      this.writeSettings(session.id),
    ];
  }

  // Deliberately no --session-id alongside --resume (composition unverified);
  // the SessionStart capture recovers the resumed conversation's actual id
  // whether claude keeps it or forks a new one.
  async resumeCommand(session: Session): Promise<string[]> {
    if (session.harnessSessionId === undefined) {
      throw new Error('claude resume requires a captured conversation id');
    }
    return [
      'claude',
      '--resume',
      session.harnessSessionId,
      '--settings',
      this.writeSettings(session.id),
    ];
  }
}
