import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Session } from '../types';
import { buildCwdCandidates, scanDevRepos } from './cwd-candidates';

function session(
  over: Partial<Session> & Pick<Session, 'id' | 'cwd'>,
): Session {
  return {
    harness: 'claude',
    tmuxWindow: '@1',
    status: 'running',
    createdAt: 0,
    statusSince: 0,
    ...over,
  };
}

describe('buildCwdCandidates', () => {
  it('ranks active cwds, then recents, then dev repos', () => {
    const sessions = [
      session({ id: 'claude-1', cwd: '/a' }),
      session({ id: 'claude-2', cwd: '/a' }),
      session({ id: 'codex-1', cwd: '/b' }),
    ];
    const out = buildCwdCandidates(sessions, ['/recent'], ['/dev/repo']);
    expect(out.map((c) => c.path)).toEqual([
      '/a',
      '/b',
      '/recent',
      '/dev/repo',
    ]);
    expect(out[0]?.annotation).toBe('★ 2 active');
    expect(out[1]?.annotation).toBe('★ 1 active');
    expect(out[2]?.annotation).toBe('recent');
    expect(out[3]?.annotation).toBeUndefined();
  });

  it('ignores exited sessions when counting active', () => {
    const sessions = [session({ id: 'claude-1', cwd: '/a', status: 'exited' })];
    const out = buildCwdCandidates(sessions, [], []);
    expect(out).toEqual([]);
  });

  it('dedupes by path keeping the best annotation', () => {
    const sessions = [session({ id: 'claude-1', cwd: '/a' })];
    const out = buildCwdCandidates(sessions, ['/a', '/b'], ['/b', '/c']);
    expect(out.map((c) => c.path)).toEqual(['/a', '/b', '/c']);
    expect(out[0]?.annotation).toBe('★ 1 active'); // active beats recent
    expect(out[1]?.annotation).toBe('recent'); // recent beats plain dev repo
    expect(out[2]?.annotation).toBeUndefined();
  });

  it('orders active cwds by count desc, then path', () => {
    const sessions = [
      session({ id: 'claude-1', cwd: '/z' }),
      session({ id: 'claude-2', cwd: '/m' }),
      session({ id: 'claude-3', cwd: '/m' }),
      session({ id: 'codex-1', cwd: '/a' }),
    ];
    const out = buildCwdCandidates(sessions, [], []);
    expect(out.map((c) => c.path)).toEqual(['/m', '/a', '/z']);
  });

  it('shortens the home dir to ~ in labels', () => {
    const home = homedir();
    const out = buildCwdCandidates(
      [],
      [join(home, 'Development', 'relos'), '/opt/x', home],
      [],
    );
    expect(out[0]?.label).toBe('~/Development/relos');
    expect(out[1]?.label).toBe('/opt/x');
    expect(out[2]?.label).toBe('~');
  });
});

describe('scanDevRepos', () => {
  it('returns sorted git repo dirs (dir or file .git), skipping the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'holo-cwd-'));
    mkdirSync(join(root, 'beta', '.git'), { recursive: true });
    mkdirSync(join(root, 'alpha'));
    writeFileSync(join(root, 'alpha', '.git'), 'gitdir: elsewhere'); // worktree-style
    mkdirSync(join(root, 'plain')); // no .git
    writeFileSync(join(root, 'stray.txt'), 'x'); // not a dir
    expect(scanDevRepos(root)).toEqual([
      join(root, 'alpha'),
      join(root, 'beta'),
    ]);
  });

  it('returns [] when the root is unreadable', () => {
    expect(scanDevRepos(join(tmpdir(), 'holo-cwd-does-not-exist'))).toEqual([]);
  });
});
