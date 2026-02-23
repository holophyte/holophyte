// @vitest-environment jsdom
import type { Id } from '@convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app';

// Reset store between tests
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    selectedOrgId: null,
    backlogCollapsed: true,
    taskPageDetailCollapsed: false,
    sessionId: null,
  });
});

afterEach(() => {
  localStorage.clear();
});

const fakeRepoId = 'repo123' as Id<'repos'>;
const fakeTaskId = 'task456' as Id<'tasks'>;
const fakeOrgId = 'org789' as Id<'organizations'>;

describe('toggleBacklog', () => {
  it('toggles backlogCollapsed state', () => {
    expect(useAppStore.getState().backlogCollapsed).toBe(true);

    useAppStore.getState().toggleBacklog();
    expect(useAppStore.getState().backlogCollapsed).toBe(false);

    useAppStore.getState().toggleBacklog();
    expect(useAppStore.getState().backlogCollapsed).toBe(true);
  });
});

describe('session actions', () => {
  it('openSession sets sessionId', () => {
    useAppStore.getState().openSession('session-1');
    expect(useAppStore.getState().sessionId).toBe('session-1');
  });

  it('closeSession clears sessionId', () => {
    useAppStore.getState().openSession('session-1');
    useAppStore.getState().closeSession();
    expect(useAppStore.getState().sessionId).toBeNull();
  });
});

describe('setSelectedOrgId', () => {
  it('sets selectedOrgId and clears bulk selection', () => {
    useAppStore.setState({ bulkSelectedTaskIds: [fakeTaskId] });

    useAppStore.getState().setSelectedOrgId(fakeOrgId);

    expect(useAppStore.getState().selectedOrgId).toBe(fakeOrgId);
    expect(useAppStore.getState().bulkSelectedTaskIds).toEqual([]);
  });
});

describe('clearOrgSelection', () => {
  it('clears selectedOrgId and bulk selection', () => {
    useAppStore.setState({
      selectedOrgId: fakeOrgId,
      bulkSelectedTaskIds: [fakeTaskId],
    });

    useAppStore.getState().clearOrgSelection();

    expect(useAppStore.getState().selectedOrgId).toBeNull();
    expect(useAppStore.getState().bulkSelectedTaskIds).toEqual([]);
  });

  it('persists cleared selectedOrgId to localStorage', () => {
    useAppStore.setState({ selectedOrgId: fakeOrgId });

    useAppStore.getState().clearOrgSelection();

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.selectedOrgId).toBeNull();
  });
});

describe('persist', () => {
  it('persists layout preferences', () => {
    useAppStore.getState().toggleBacklog();
    useAppStore.getState().toggleTaskPageDetail();

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.backlogCollapsed).toBe(false);
    expect(stored.state.taskPageDetailCollapsed).toBe(true);
  });

  it('does not persist transient state', () => {
    useAppStore.getState().openSession('session-1');

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.sessionId).toBeUndefined();
  });

  it('does not persist selectedRepoId or viewMode (managed by router)', () => {
    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state?.selectedRepoId).toBeUndefined();
    expect(stored.state?.viewMode).toBeUndefined();
  });
});

// Satisfy unused variable lint — these are used as type checks
void fakeRepoId;
