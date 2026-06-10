import { describe, expect, it } from 'vitest';
import type { ExecFileLike } from './diffstat';
import { makeDiffStat } from './diffstat';

function fakeExec(result: { error?: Error; stdout?: string }) {
  const calls: Array<{ file: string; args: readonly string[] }> = [];
  const exec: ExecFileLike = (file, args, callback) => {
    calls.push({ file, args });
    callback(result.error ?? null, result.stdout ?? '', '');
  };
  return { exec, calls };
}

describe('makeDiffStat', () => {
  it('runs git -C <cwd> diff --stat', async () => {
    const { exec, calls } = fakeExec({ stdout: ' 1 file changed\n' });
    await makeDiffStat(exec)('/repo');
    expect(calls).toEqual([{ file: 'git', args: ['-C', '/repo', 'diff', '--stat'] }]);
  });

  it('trims the output', async () => {
    const { exec } = fakeExec({ stdout: '\n 2 files changed, 4 insertions(+)\n\n' });
    await expect(makeDiffStat(exec)('/repo')).resolves.toBe('2 files changed, 4 insertions(+)');
  });

  it('reports a clean tree on empty or whitespace-only stdout', async () => {
    await expect(makeDiffStat(fakeExec({ stdout: '' }).exec)('/r')).resolves.toBe('working tree clean');
    await expect(makeDiffStat(fakeExec({ stdout: '  \n ' }).exec)('/r')).resolves.toBe('working tree clean');
  });

  it('resolves "no diff available" on error', async () => {
    const { exec } = fakeExec({ error: new Error('not a git repo') });
    await expect(makeDiffStat(exec)('/nope')).resolves.toBe('no diff available');
  });

  it('caps long output at 2000 chars with an ellipsis', async () => {
    const { exec } = fakeExec({ stdout: 'x'.repeat(5000) });
    const out = await makeDiffStat(exec)('/repo');
    expect(out).toHaveLength(2001);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('xxx')).toBe(true);
  });
});
