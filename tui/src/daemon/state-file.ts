/**
 * Daemon state persistence — ~/.holo/state.json (path injected by caller).
 * Load never throws: a corrupt or missing state file means a fresh registry,
 * not a dead daemon. Save is atomic (tmp + rename) so a crash mid-write
 * can't torch existing state.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Session } from '../types';
import type { RegistryJSON } from './registry';

export function loadStateFile(path: string): RegistryJSON | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return null; // missing/unreadable file
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // unparsable JSON
  }
  if (!isPlainObject(parsed)) return null;
  // Minimal shape validation — fill missing/mistyped fields with defaults.
  return {
    // absent ⇒ 0, which triggers fromJSON's pre-v1 codex-id migration
    version: typeof parsed.version === 'number' ? parsed.version : 0,
    sessions: Array.isArray(parsed.sessions)
      ? (parsed.sessions as Session[])
      : [],
    counters: isPlainObject(parsed.counters)
      ? (parsed.counters as Record<string, number>)
      : {},
    recentCwds: Array.isArray(parsed.recentCwds)
      ? (parsed.recentCwds as string[])
      : [],
  };
}

export function saveStateFile(path: string, data: RegistryJSON): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  // Pretty-printed for human debuggability.
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(tmp, path);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
