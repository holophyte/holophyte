/**
 * Ranked cwd candidates for the new-session picker:
 * active-session cwds first, then recent spawn targets, then ~/Development
 * git repos. Pure ranking logic; only scanDevRepos touches the filesystem.
 */

import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import type { Session } from '../types';

export interface CwdCandidate {
  path: string;
  label: string;
  annotation?: string;
}

export function buildCwdCandidates(
  sessions: Session[],
  recentCwds: string[],
  devRepos: string[],
): CwdCandidate[] {
  const activeCounts = new Map<string, number>();
  for (const session of sessions) {
    if (session.status === 'exited') continue;
    activeCounts.set(session.cwd, (activeCounts.get(session.cwd) ?? 0) + 1);
  }

  const out: CwdCandidate[] = [];
  const seen = new Set<string>();
  const add = (path: string, annotation?: string) => {
    if (seen.has(path)) return; // first occurrence carries the best annotation
    seen.add(path);
    out.push({
      path,
      label: shortenHome(path),
      ...(annotation !== undefined ? { annotation } : {}),
    });
  };

  const active = [...activeCounts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
  );
  for (const [path, count] of active) add(path, `★ ${count} active`);
  for (const path of recentCwds) add(path, 'recent');
  for (const path of devRepos) add(path);
  return out;
}

/** Git repos directly under `root` (default ~/Development), sorted. Errors → []. */
export function scanDevRepos(root?: string): string[] {
  const base = root ?? join(homedir(), 'Development');
  try {
    return readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(base, entry.name))
      .filter((dir) => existsSync(join(dir, '.git'))) // .git dir or worktree file
      .sort();
  } catch {
    return [];
  }
}

function shortenHome(path: string): string {
  const home = homedir();
  if (path === home) return '~';
  if (path.startsWith(home + sep)) return `~${path.slice(home.length)}`;
  return path;
}
