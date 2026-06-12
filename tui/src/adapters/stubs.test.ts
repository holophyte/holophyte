// @vitest-environment node
import type { Session } from '../types';
import { stubAdapter } from './stubs';

const session: Session = {
  id: 'cursor-1',
  harness: 'cursor',
  cwd: '/tmp/repo',
  tmuxWindow: '@4',
  status: 'running',
  createdAt: 0,
  statusSince: 0,
};

describe('stubAdapter', () => {
  it.each([
    'cursor',
    'devin',
  ] as const)('%s is unconfigured with no capabilities', (id) => {
    const adapter = stubAdapter(id);
    expect(adapter.id).toBe(id);
    expect(adapter.configured()).toBe(false);
    expect(adapter.capabilities).toEqual({
      remotePermission: false,
      questionText: false,
    });
  });

  it.each(['cursor', 'devin'] as const)('%s spawnCommand throws', (id) => {
    expect(() => stubAdapter(id).spawnCommand(session)).toThrow(
      `${id} is not configured (post-v1)`,
    );
  });
});
