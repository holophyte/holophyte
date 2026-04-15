// @vitest-environment jsdom
import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app';

// Reset store between tests
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    selectedOrgId: null,
    collapsedColumns: new Set([TaskStatus.Backlog]),
    taskPageDetailCollapsed: false,
    activeSessionId: null,
    searchQuery: '',
    filterLabelIds: [],
    showArchive: false,
    theme: 'dark',
    lastUsedRepoId: null,
    sidebarCollapsed: false,
    bulkSelectedTaskIds: [],
  });
});

afterEach(() => {
  localStorage.clear();
});

const fakeRepoId = 'repo123' as Id<'repos'>;
const fakeTaskId = 'task456' as Id<'tasks'>;
const fakeOrgId = 'org789' as Id<'organizations'>;

describe('toggleBacklog', () => {
  it('toggles backlog membership in collapsedColumns', () => {
    expect(
      useAppStore.getState().collapsedColumns.has(TaskStatus.Backlog),
    ).toBe(true);

    useAppStore.getState().toggleBacklog();
    expect(
      useAppStore.getState().collapsedColumns.has(TaskStatus.Backlog),
    ).toBe(false);

    useAppStore.getState().toggleBacklog();
    expect(
      useAppStore.getState().collapsedColumns.has(TaskStatus.Backlog),
    ).toBe(true);
  });
});

describe('toggleColumnCollapsed', () => {
  it('toggles arbitrary column membership in collapsedColumns', () => {
    expect(useAppStore.getState().collapsedColumns.has(TaskStatus.Done)).toBe(
      false,
    );

    useAppStore.getState().toggleColumnCollapsed(TaskStatus.Done);
    expect(useAppStore.getState().collapsedColumns.has(TaskStatus.Done)).toBe(
      true,
    );

    useAppStore.getState().toggleColumnCollapsed(TaskStatus.Done);
    expect(useAppStore.getState().collapsedColumns.has(TaskStatus.Done)).toBe(
      false,
    );
  });

  it('clears bulkSelectedTaskIds when collapsing a column', () => {
    const fakeTaskId2 = 'task111' as Id<'tasks'>;
    useAppStore.setState({ bulkSelectedTaskIds: [fakeTaskId, fakeTaskId2] });

    // Collapse the Done column (currently expanded)
    useAppStore.getState().toggleColumnCollapsed(TaskStatus.Done);

    expect(useAppStore.getState().collapsedColumns.has(TaskStatus.Done)).toBe(
      true,
    );
    expect(useAppStore.getState().bulkSelectedTaskIds).toEqual([]);

    // Expand the Done column — bulk selection should remain empty (not restored)
    useAppStore.getState().toggleColumnCollapsed(TaskStatus.Done);

    expect(useAppStore.getState().collapsedColumns.has(TaskStatus.Done)).toBe(
      false,
    );
    expect(useAppStore.getState().bulkSelectedTaskIds).toEqual([]);
  });
});

describe('session actions', () => {
  it('openSession sets activeSessionId', () => {
    useAppStore.getState().openSession('session-1');
    expect(useAppStore.getState().activeSessionId).toBe('session-1');
  });

  it('closeSession clears activeSessionId', () => {
    useAppStore.getState().openSession('session-1');
    useAppStore.getState().closeSession();
    expect(useAppStore.getState().activeSessionId).toBeNull();
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

  it('does not persist selectedOrgId to localStorage', () => {
    useAppStore.setState({ selectedOrgId: fakeOrgId });

    useAppStore.getState().clearOrgSelection();

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.selectedOrgId).toBeUndefined();
  });
});

describe('persist', () => {
  it('persists layout preferences', () => {
    useAppStore.getState().toggleBacklog();
    useAppStore.getState().toggleColumnCollapsed(TaskStatus.Done);
    useAppStore.getState().toggleTaskPageDetail();

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.collapsedColumns).toEqual({
      __type: 'Set',
      values: [TaskStatus.Done],
    });
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

  it('migrates legacy backlogCollapsed storage into collapsedColumns', async () => {
    localStorage.setItem(
      'holophyte-app',
      JSON.stringify({
        state: {
          backlogCollapsed: true,
          taskPageDetailCollapsed: false,
          sidebarCollapsed: false,
          showArchive: false,
          lastUsedRepoId: null,
          theme: 'kolada',
        },
        version: 4,
      }),
    );

    await useAppStore.persist.rehydrate();

    expect(
      useAppStore.getState().collapsedColumns.has(TaskStatus.Backlog),
    ).toBe(true);

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.version).toBe(7);
    expect(stored.state.backlogCollapsed).toBeUndefined();
    expect(stored.state.collapsedColumns).toEqual({
      __type: 'Set',
      values: [TaskStatus.Backlog],
    });
  });

  it('falls back to default theme when a removed theme is persisted', async () => {
    localStorage.setItem(
      'holophyte-app',
      JSON.stringify({
        state: {
          collapsedColumns: {
            __type: 'Set',
            values: [TaskStatus.Backlog, TaskStatus.Done],
          },
          taskPageDetailCollapsed: false,
          sidebarCollapsed: false,
          showArchive: false,
          lastUsedRepoId: null,
          theme: 'neon',
        },
        version: 5,
      }),
    );

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().theme).toBe('dark');
    expect(useAppStore.getState().collapsedColumns).toEqual(
      new Set([TaskStatus.Backlog, TaskStatus.Done]),
    );

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.version).toBe(7);
    expect(stored.state.theme).toBe('dark');
    expect(stored.state.collapsedColumns).toEqual({
      __type: 'Set',
      values: [TaskStatus.Backlog, TaskStatus.Done],
    });
  });

  it.each([
    ['kolada', 'dark'],
    ['dune', 'light'],
  ])('migrates legacy theme %s → %s', async (legacy, expected) => {
    localStorage.setItem(
      'holophyte-app',
      JSON.stringify({
        state: {
          collapsedColumns: { __type: 'Set', values: [TaskStatus.Backlog] },
          taskPageDetailCollapsed: false,
          sidebarCollapsed: false,
          showArchive: false,
          lastUsedRepoId: null,
          theme: legacy,
        },
        version: 6,
      }),
    );

    await useAppStore.persist.rehydrate();

    expect(useAppStore.getState().theme).toBe(expected);
    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.version).toBe(7);
    expect(stored.state.theme).toBe(expected);
  });
});

// Satisfy unused variable lint — these are used as type checks
void fakeRepoId;
