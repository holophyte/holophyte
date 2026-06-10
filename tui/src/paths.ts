import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Root dir for holo state. Override with HOLO_HOME — tests point this at a
 * tmpdir so daemon/socket/state never touch the real ~/.holo. Keep socket
 * paths short: macOS caps Unix socket paths at ~104 chars.
 */
export function holoHome(): string {
  return process.env.HOLO_HOME ?? join(homedir(), '.holo');
}

export function socketPath(): string {
  return join(holoHome(), 'holod.sock');
}

export function statePath(): string {
  return join(holoHome(), 'state.json');
}

export function sessionDir(id: string): string {
  return join(holoHome(), 'sessions', id);
}

/** generated per-session hook settings (Claude --settings file etc.) */
export function sessionSettingsPath(id: string): string {
  return join(sessionDir(id), 'settings.json');
}

/** tmux session that owns the TUI (window 0) and all agent windows */
export function tmuxSessionName(): string {
  return process.env.HOLO_TMUX_SESSION ?? 'holo';
}
