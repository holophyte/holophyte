import { describe, expect, it } from 'vitest';
import { fuzzyMatch } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches everything with an empty needle', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
    expect(fuzzyMatch('', '')).toBe(true);
  });

  it('matches exact strings', () => {
    expect(fuzzyMatch('relos', 'relos')).toBe(true);
  });

  it('matches subsequences', () => {
    expect(fuzzyMatch('hlo', 'holo')).toBe(true);
    expect(fuzzyMatch('dvrl', '~/Development/relos')).toBe(true);
  });

  it('is case-insensitive both ways', () => {
    expect(fuzzyMatch('RELOS', 'relos')).toBe(true);
    expect(fuzzyMatch('relos', 'RELOS')).toBe(true);
  });

  it('rejects non-subsequences', () => {
    expect(fuzzyMatch('xyz', 'holo')).toBe(false);
    expect(fuzzyMatch('oloh', 'holo')).toBe(false); // order matters
  });

  it('rejects needles longer than the haystack', () => {
    expect(fuzzyMatch('holophyte', 'holo')).toBe(false);
  });

  it('rejects any needle against an empty haystack', () => {
    expect(fuzzyMatch('a', '')).toBe(false);
  });
});
