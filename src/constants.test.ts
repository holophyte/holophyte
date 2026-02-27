// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL,
  QUEUED_SESSION_TIMEOUT_MS,
  QUEUED_WARNING_THRESHOLD_MS,
} from './constants';

describe('constants', () => {
  it('DEFAULT_MODEL is a non-empty string', () => {
    expect(typeof DEFAULT_MODEL).toBe('string');
    expect(DEFAULT_MODEL.length).toBeGreaterThan(0);
  });

  it('QUEUED_SESSION_TIMEOUT_MS is 10 minutes', () => {
    expect(QUEUED_SESSION_TIMEOUT_MS).toBe(10 * 60 * 1000);
  });

  it('QUEUED_WARNING_THRESHOLD_MS is 30 seconds', () => {
    expect(QUEUED_WARNING_THRESHOLD_MS).toBe(30 * 1000);
  });

  it('warning threshold is less than session timeout', () => {
    expect(QUEUED_WARNING_THRESHOLD_MS).toBeLessThan(QUEUED_SESSION_TIMEOUT_MS);
  });
});
