/**
 * git diff --stat for the preview pane. Output is shaped for display:
 * trimmed, capped, with explicit text for clean trees and failures.
 */

import { execFile } from 'node:child_process';

export type DiffStatRunner = (cwd: string) => Promise<string>;

/** Minimal execFile shape so tests can inject a fake. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  callback: (error: Error | null, stdout: string, stderr: string) => void,
) => unknown;

const MAX_CHARS = 2000;

export function makeDiffStat(exec: ExecFileLike = execFile): DiffStatRunner {
  return (cwd) =>
    new Promise((resolve) => {
      exec('git', ['-C', cwd, 'diff', '--stat'], (error, stdout) => {
        if (error) {
          resolve('no diff available');
          return;
        }
        const text = stdout.trim();
        if (text === '') {
          resolve('working tree clean');
          return;
        }
        resolve(
          text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text,
        );
      });
    });
}

export const gitDiffStat: DiffStatRunner = makeDiffStat();
