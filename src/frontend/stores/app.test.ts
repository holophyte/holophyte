// @vitest-environment jsdom
import type { Id } from '@convex/_generated/dataModel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './app';

// Reset store between tests
beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    selectedRepoId: null,
    selectedTaskId: null,
    viewMode: 'board',
    backlogCollapsed: true,
    terminalSessionId: null,
    terminalMinimized: false,
  });
});

afterEach(() => {
  localStorage.clear();
});

const fakeRepoId = 'repo123' as Id<'repos'>;
const fakeTaskId = 'task456' as Id<'tasks'>;

describe('selectRepo', () => {
  it('sets selectedRepoId and switches to board view', () => {
    useAppStore.getState().selectSeedBox();
    expect(useAppStore.getState().viewMode).toBe('seeds');

    useAppStore.getState().selectRepo(fakeRepoId);
    expect(useAppStore.getState().selectedRepoId).toBe(fakeRepoId);
    expect(useAppStore.getState().viewMode).toBe('board');
  });

  it('sets selectedRepoId to null for all tasks', () => {
    useAppStore.getState().selectRepo(fakeRepoId);
    useAppStore.getState().selectRepo(null);
    expect(useAppStore.getState().selectedRepoId).toBeNull();
    expect(useAppStore.getState().viewMode).toBe('board');
  });
});

describe('selectSeedBox', () => {
  it('switches to seeds view and clears selections', () => {
    useAppStore.getState().selectRepo(fakeRepoId);
    useAppStore.getState().selectTask(fakeTaskId);

    useAppStore.getState().selectSeedBox();
    expect(useAppStore.getState().viewMode).toBe('seeds');
    expect(useAppStore.getState().selectedRepoId).toBeNull();
    expect(useAppStore.getState().selectedTaskId).toBeNull();
  });
});

describe('toggleBacklog', () => {
  it('toggles backlogCollapsed state', () => {
    expect(useAppStore.getState().backlogCollapsed).toBe(true);

    useAppStore.getState().toggleBacklog();
    expect(useAppStore.getState().backlogCollapsed).toBe(false);

    useAppStore.getState().toggleBacklog();
    expect(useAppStore.getState().backlogCollapsed).toBe(true);
  });
});

describe('selectTask', () => {
  it('sets and clears selectedTaskId', () => {
    useAppStore.getState().selectTask(fakeTaskId);
    expect(useAppStore.getState().selectedTaskId).toBe(fakeTaskId);

    useAppStore.getState().selectTask(null);
    expect(useAppStore.getState().selectedTaskId).toBeNull();
  });
});

describe('terminal actions', () => {
  it('openTerminal sets sessionId and un-minimizes', () => {
    useAppStore.setState({ terminalMinimized: true });

    useAppStore.getState().openTerminal('session-1');
    expect(useAppStore.getState().terminalSessionId).toBe('session-1');
    expect(useAppStore.getState().terminalMinimized).toBe(false);
  });

  it('closeTerminal clears sessionId and un-minimizes', () => {
    useAppStore.getState().openTerminal('session-1');
    useAppStore.setState({ terminalMinimized: true });

    useAppStore.getState().closeTerminal();
    expect(useAppStore.getState().terminalSessionId).toBeNull();
    expect(useAppStore.getState().terminalMinimized).toBe(false);
  });

  it('toggleTerminalMinimized toggles the minimized state', () => {
    expect(useAppStore.getState().terminalMinimized).toBe(false);

    useAppStore.getState().toggleTerminalMinimized();
    expect(useAppStore.getState().terminalMinimized).toBe(true);

    useAppStore.getState().toggleTerminalMinimized();
    expect(useAppStore.getState().terminalMinimized).toBe(false);
  });
});

describe('persist', () => {
  it('persists selectedRepoId, viewMode, and backlogCollapsed', () => {
    useAppStore.getState().selectRepo(fakeRepoId);
    useAppStore.getState().toggleBacklog();

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.selectedRepoId).toBe(fakeRepoId);
    expect(stored.state.viewMode).toBe('board');
    expect(stored.state.backlogCollapsed).toBe(false);
  });

  it('does not persist transient state', () => {
    useAppStore.getState().selectTask(fakeTaskId);
    useAppStore.getState().openTerminal('session-1');

    const stored = JSON.parse(localStorage.getItem('holophyte-app') ?? '{}');
    expect(stored.state.selectedTaskId).toBeUndefined();
    expect(stored.state.terminalSessionId).toBeUndefined();
    expect(stored.state.terminalMinimized).toBeUndefined();
  });
});
