import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '../types';
import { type RegistryJSON, STATE_VERSION } from './registry';
import { loadStateFile, saveStateFile } from './state-file';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'holo-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function sampleData(): RegistryJSON {
  const session: Session = {
    id: 'claude-1',
    harness: 'claude',
    cwd: '/repo/a',
    tmuxWindow: '@2',
    status: 'needs_input',
    attentionReason: 'Pick a name',
    lastMessage: 'Which name do you prefer?',
    createdAt: 1000,
    statusSince: 2000,
    harnessSessionId: 'b9a5e1c0-0000-4000-8000-000000000000',
  };
  return {
    version: STATE_VERSION,
    sessions: [session],
    counters: { claude: 1 },
    recentCwds: ['/repo/a'],
  };
}

describe('loadStateFile', () => {
  it('returns null for a missing file', () => {
    expect(loadStateFile(join(dir, 'nope.json'))).toBeNull();
  });

  it('returns null for unparsable JSON', () => {
    const path = join(dir, 'state.json');
    writeFileSync(path, '{ definitely not json');
    expect(loadStateFile(path)).toBeNull();
  });

  it('returns null for non-object JSON', () => {
    const path = join(dir, 'state.json');
    for (const content of ['"hello"', '42', 'null', 'true', '[1,2,3]']) {
      writeFileSync(path, content);
      expect(loadStateFile(path)).toBeNull();
    }
  });

  it('fills missing fields with defaults', () => {
    const path = join(dir, 'state.json');
    writeFileSync(path, '{}');
    expect(loadStateFile(path)).toEqual({
      version: 0,
      sessions: [],
      counters: {},
      recentCwds: [],
    });
  });

  it('replaces mistyped fields with defaults instead of rejecting', () => {
    const path = join(dir, 'state.json');
    writeFileSync(
      path,
      JSON.stringify({
        sessions: 'nope',
        counters: [1, 2],
        recentCwds: { a: 1 },
      }),
    );
    expect(loadStateFile(path)).toEqual({
      version: 0,
      sessions: [],
      counters: {},
      recentCwds: [],
    });
  });

  it('keeps valid fields alongside defaulted ones', () => {
    const path = join(dir, 'state.json');
    writeFileSync(path, JSON.stringify({ counters: { claude: 3 } }));
    expect(loadStateFile(path)).toEqual({
      version: 0,
      sessions: [],
      counters: { claude: 3 },
      recentCwds: [],
    });
  });
});

describe('saveStateFile', () => {
  it('round-trips through load', () => {
    const path = join(dir, 'state.json');
    const data = sampleData();
    saveStateFile(path, data);
    expect(loadStateFile(path)).toEqual(data);
  });

  it('creates parent directories', () => {
    const path = join(dir, 'nested', 'deep', 'state.json');
    saveStateFile(path, sampleData());
    expect(loadStateFile(path)).toEqual(sampleData());
  });

  it('writes pretty-printed JSON and leaves no tmp file behind', () => {
    const path = join(dir, 'state.json');
    saveStateFile(path, sampleData());
    const raw = readFileSync(path, 'utf8');
    expect(raw).toContain('\n  "sessions"');
    expect(raw.endsWith('\n')).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  it('atomically replaces an existing file', () => {
    const path = join(dir, 'state.json');
    saveStateFile(path, sampleData());
    const updated: RegistryJSON = {
      version: STATE_VERSION,
      sessions: [],
      counters: { claude: 9 },
      recentCwds: [],
    };
    saveStateFile(path, updated);
    expect(loadStateFile(path)).toEqual(updated);
  });
});
