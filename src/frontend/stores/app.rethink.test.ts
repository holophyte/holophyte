/**
 * Tests for session-rethink Zustand store changes:
 * - Replace `sessionId` with `activeSessionId`
 * - Add `switchSession(sessionId)` action
 * - `openSession` renamed/kept but sets `activeSessionId`
 * - `closeSession` clears `activeSessionId`
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app';

// Reset store state between tests
beforeEach(() => {
  useAppStore.setState({
    activeSessionId: null,
  });
});

describe('store: activeSessionId (replaces sessionId)', () => {
  it('initial activeSessionId is null', () => {
    const state = useAppStore.getState();
    expect(state.activeSessionId).toBeNull();
  });

  it('openSession sets activeSessionId', () => {
    const { openSession } = useAppStore.getState();
    openSession('session-abc');
    expect(useAppStore.getState().activeSessionId).toBe('session-abc');
  });

  it('closeSession clears activeSessionId', () => {
    useAppStore.setState({ activeSessionId: 'session-abc' });
    const { closeSession } = useAppStore.getState();
    closeSession();
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });
});

describe('store: switchSession', () => {
  it('switchSession changes activeSessionId', () => {
    useAppStore.setState({ activeSessionId: 'session-1' });
    const { switchSession } = useAppStore.getState();
    switchSession('session-2');
    expect(useAppStore.getState().activeSessionId).toBe('session-2');
  });

  it('switchSession to null clears the active session', () => {
    useAppStore.setState({ activeSessionId: 'session-1' });
    const { switchSession } = useAppStore.getState();
    switchSession(null);
    expect(useAppStore.getState().activeSessionId).toBeNull();
  });
});

describe('store: backward compat — no sessionId field', () => {
  it('does not have a sessionId field (replaced by activeSessionId)', () => {
    const state = useAppStore.getState();
    // The old `sessionId` field should no longer exist
    expect('sessionId' in state).toBe(false);
    // The new field should exist
    expect('activeSessionId' in state).toBe(true);
  });
});
