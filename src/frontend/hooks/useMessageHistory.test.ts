import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useMessageHistory } from './useMessageHistory';

describe('useMessageHistory', () => {
  describe('push', () => {
    it('records messages in history', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('hello');
      // Navigate up to confirm message was recorded
      expect(result.current.handleArrowKey('up', '')).toBe('hello');
    });

    it('appends multiple messages in order, newest last', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('first');
      result.current.push('second');
      // Up from bottom should give most recent
      expect(result.current.handleArrowKey('up', '')).toBe('second');
    });

    it('resets navigation index after push', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('first');
      result.current.handleArrowKey('up', '');
      result.current.push('second');
      // Index should be reset — up again should give most recent (second)
      expect(result.current.handleArrowKey('up', '')).toBe('second');
    });
  });

  describe('handleArrowKey — up', () => {
    it('returns null when history is empty', () => {
      const { result } = renderHook(() => useMessageHistory());
      expect(result.current.handleArrowKey('up', 'draft')).toBeNull();
    });

    it('saves draft and returns most recent on first up', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg1');
      result.current.push('msg2');
      expect(result.current.handleArrowKey('up', 'my draft')).toBe('msg2');
    });

    it('navigates older on subsequent up presses', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg1');
      result.current.push('msg2');
      result.current.push('msg3');
      result.current.handleArrowKey('up', '');
      expect(result.current.handleArrowKey('up', 'msg3')).toBe('msg2');
      expect(result.current.handleArrowKey('up', 'msg2')).toBe('msg1');
    });

    it('returns null when already at oldest message', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('only');
      result.current.handleArrowKey('up', '');
      expect(result.current.handleArrowKey('up', 'only')).toBeNull();
    });
  });

  describe('handleArrowKey — down', () => {
    it('returns null when not navigating', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg');
      expect(result.current.handleArrowKey('down', '')).toBeNull();
    });

    it('navigates newer on down press', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg1');
      result.current.push('msg2');
      result.current.push('msg3');
      result.current.handleArrowKey('up', '');
      result.current.handleArrowKey('up', 'msg3');
      result.current.handleArrowKey('up', 'msg2');
      // Now at msg1, navigate down
      expect(result.current.handleArrowKey('down', 'msg1')).toBe('msg2');
    });

    it('restores draft when going past newest', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg1');
      result.current.push('msg2');
      result.current.handleArrowKey('up', 'my draft');
      // At msg2, navigate down — should restore draft
      expect(result.current.handleArrowKey('down', 'msg2')).toBe('my draft');
    });

    it('resets index to -1 when restoring draft', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg');
      result.current.handleArrowKey('up', 'draft text');
      result.current.handleArrowKey('down', 'msg');
      // After restoring draft, down again should be null
      expect(result.current.handleArrowKey('down', 'draft text')).toBeNull();
    });
  });

  describe('resetNavigation', () => {
    it('exits history browsing mode', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg');
      result.current.handleArrowKey('up', '');
      result.current.resetNavigation();
      // Down should now be null since we're not navigating
      expect(result.current.handleArrowKey('down', '')).toBeNull();
    });

    it('allows fresh up navigation after reset', () => {
      const { result } = renderHook(() => useMessageHistory());
      result.current.push('msg1');
      result.current.push('msg2');
      result.current.handleArrowKey('up', '');
      result.current.handleArrowKey('up', 'msg2');
      result.current.resetNavigation();
      // Up from reset state should give most recent again
      expect(result.current.handleArrowKey('up', 'new draft')).toBe('msg2');
    });
  });

  describe('MAX_HISTORY cap', () => {
    it('caps history at 100 entries, dropping the oldest', () => {
      const { result } = renderHook(() => useMessageHistory());
      // Push 101 messages
      for (let i = 0; i < 101; i++) {
        result.current.push(`msg-${i}`);
      }
      // msg-0 was dropped; navigating all the way back should land on msg-1
      // Navigate to oldest by pressing up 100 times
      let oldest: string | null = null;
      for (let i = 0; i < 100; i++) {
        const candidate = result.current.handleArrowKey(
          'up',
          i === 0 ? '' : `msg-${i}`,
        );
        if (candidate !== null) oldest = candidate;
      }
      // Oldest kept is msg-1 (msg-0 was evicted)
      expect(oldest).toBe('msg-1');
    });

    it('keeps exactly 100 entries after 105 pushes', () => {
      const { result } = renderHook(() => useMessageHistory());
      for (let i = 0; i < 105; i++) {
        result.current.push(`msg-${i}`);
      }
      // Newest is msg-104; it should be reachable as first up
      expect(result.current.handleArrowKey('up', '')).toBe('msg-104');
      // Navigate all the way back — after 100 ups we should reach msg-5
      // (first 5 were evicted)
      let last: string | null = null;
      // Reset by pushing then re-navigating from scratch
      const { result: r2 } = renderHook(() => useMessageHistory());
      for (let i = 0; i < 105; i++) {
        r2.current.push(`item-${i}`);
      }
      for (let i = 0; i < 100; i++) {
        const v = r2.current.handleArrowKey('up', '');
        if (v !== null) last = v;
      }
      expect(last).toBe('item-5');
    });
  });

  describe('function reference stability', () => {
    it('push is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useMessageHistory());
      const push1 = result.current.push;
      rerender();
      expect(result.current.push).toBe(push1);
    });

    it('handleArrowKey is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useMessageHistory());
      const fn1 = result.current.handleArrowKey;
      rerender();
      expect(result.current.handleArrowKey).toBe(fn1);
    });

    it('resetNavigation is stable across re-renders', () => {
      const { result, rerender } = renderHook(() => useMessageHistory());
      const fn1 = result.current.resetNavigation;
      rerender();
      expect(result.current.resetNavigation).toBe(fn1);
    });
  });
});
