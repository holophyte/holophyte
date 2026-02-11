import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStickyValue } from './useStickyValue';

describe('useStickyValue', () => {
  it('returns undefined when initial value is undefined', () => {
    const { result } = renderHook(() => useStickyValue(undefined));
    expect(result.current).toBeUndefined();
  });

  it('returns the value when defined', () => {
    const { result } = renderHook(() => useStickyValue('hello'));
    expect(result.current).toBe('hello');
  });

  it('keeps previous value when current becomes undefined', () => {
    let value: string | undefined = 'first';
    const { result, rerender } = renderHook(() => useStickyValue(value));
    expect(result.current).toBe('first');

    value = undefined;
    rerender();
    expect(result.current).toBe('first');
  });

  it('updates to new value when defined again', () => {
    let value: string | undefined = 'first';
    const { result, rerender } = renderHook(() => useStickyValue(value));
    expect(result.current).toBe('first');

    value = undefined;
    rerender();
    expect(result.current).toBe('first');

    value = 'second';
    rerender();
    expect(result.current).toBe('second');
  });

  it('works with object values', () => {
    const obj1 = { id: 1, name: 'task A' };
    const obj2 = { id: 2, name: 'task B' };

    let value: typeof obj1 | undefined = obj1;
    const { result, rerender } = renderHook(() => useStickyValue(value));
    expect(result.current).toBe(obj1);

    value = undefined;
    rerender();
    expect(result.current).toBe(obj1);

    value = obj2;
    rerender();
    expect(result.current).toBe(obj2);
  });

  it('works with array values', () => {
    const arr1 = [1, 2, 3];
    let value: number[] | undefined = arr1;
    const { result, rerender } = renderHook(() => useStickyValue(value));
    expect(result.current).toBe(arr1);

    value = undefined;
    rerender();
    expect(result.current).toBe(arr1);
  });

  describe('with key', () => {
    it('resets when key changes', () => {
      let value: string | undefined = 'task-A-data';
      let key: string = 'A';
      const { result, rerender } = renderHook(() => useStickyValue(value, key));
      expect(result.current).toBe('task-A-data');

      // Switch to key B with undefined value (simulates query loading)
      key = 'B';
      value = undefined;
      rerender();
      expect(result.current).toBeUndefined();
    });

    it('still sticks within the same key', () => {
      let value: string | undefined = 'data';
      const key = 'A';
      const { result, rerender } = renderHook(() => useStickyValue(value, key));
      expect(result.current).toBe('data');

      value = undefined;
      rerender();
      expect(result.current).toBe('data');
    });

    it('picks up new value after key reset', () => {
      let value: string | undefined = 'old';
      let key: string = 'A';
      const { result, rerender } = renderHook(() => useStickyValue(value, key));

      key = 'B';
      value = undefined;
      rerender();
      expect(result.current).toBeUndefined();

      value = 'new';
      rerender();
      expect(result.current).toBe('new');
    });

    it('works without key (backwards compatible)', () => {
      let value: string | undefined = 'first';
      const { result, rerender } = renderHook(() => useStickyValue(value));
      expect(result.current).toBe('first');

      value = undefined;
      rerender();
      expect(result.current).toBe('first');
    });
  });
});
