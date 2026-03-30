// @vitest-environment edge-runtime
import { describe, expect, it } from 'vitest';
import { hashApiKey } from './apiKeyHash';

describe('hashApiKey', () => {
  it('produces a 64-character hex string', async () => {
    const hash = await hashApiKey('holo_test');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent output for the same input', async () => {
    const key = 'holo_abc123';
    const hash1 = await hashApiKey(key);
    const hash2 = await hashApiKey(key);
    expect(hash1).toBe(hash2);
  });

  it('produces different output for different inputs', async () => {
    const hash1 = await hashApiKey('holo_aaaa');
    const hash2 = await hashApiKey('holo_bbbb');
    expect(hash1).not.toBe(hash2);
  });

  it('is sensitive to whitespace differences', async () => {
    const hash1 = await hashApiKey('holo_test');
    const hash2 = await hashApiKey('holo_test ');
    expect(hash1).not.toBe(hash2);
  });
});
