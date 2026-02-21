import type { Id } from '@convex/_generated/dataModel';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ThemeName =
  | 'neon'
  | 'flora'
  | 'infrared'
  | 'verdant'
  | 'rosewood'
  | 'paper'
  | 'dune'
  | 'arctic';

export const VALID_THEMES: ThemeName[] = [
  'neon',
  'flora',
  'infrared',
  'verdant',
  'rosewood',
  'paper',
  'dune',
  'arctic',
];

export const DEFAULT_THEME: ThemeName = 'neon';

type ViewMode = 'board' | 'seeds' | 'task-page';

interface AppState {
  selectedOrgId: Id<'organizations'> | null;
  selectedRepoId: Id<'repos'> | null;
  selectedTaskId: Id<'tasks'> | null;
  viewMode: ViewMode;
  backlogCollapsed: boolean;
  taskPageDetailCollapsed: boolean;
  sessionId: string | null;

  // Search and filter state
  searchQuery: string;
  filterLabelIds: Id<'labels'>[];
  showArchive: boolean;
  doneColumnCollapsed: boolean;

  // Theme
  theme: ThemeName;

  // Bulk selection state
  bulkSelectedTaskIds: Id<'tasks'>[];

  setTheme: (theme: ThemeName) => void;
  setSelectedOrgId: (id: Id<'organizations'>) => void;
  clearOrgSelection: () => void;
  selectRepo: (id: Id<'repos'> | null) => void;
  selectSeedBox: () => void;
  selectTask: (id: Id<'tasks'> | null) => void;
  openTaskPage: (id: Id<'tasks'>) => void;
  toggleBacklog: () => void;
  toggleTaskPageDetail: () => void;
  /** Switch from task page back to board view, keeping the task selected in the side panel. */
  collapseTaskPage: () => void;
  openSession: (sessionId: string) => void;
  closeSession: () => void;

  // Search and filter actions
  setSearchQuery: (query: string) => void;
  toggleFilterLabel: (labelId: Id<'labels'>) => void;
  clearFilters: () => void;
  toggleArchive: () => void;
  toggleDoneCollapsed: () => void;

  // Bulk selection actions
  toggleBulkSelectTask: (id: Id<'tasks'>) => void;
  bulkSelectAll: (ids: Id<'tasks'>[]) => void;
  bulkDeselectAll: (ids: Id<'tasks'>[]) => void;
  clearBulkSelection: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedOrgId: null,
      selectedRepoId: null,
      selectedTaskId: null,
      viewMode: 'board',
      backlogCollapsed: true,
      taskPageDetailCollapsed: false,
      sessionId: null,

      searchQuery: '',
      filterLabelIds: [],
      showArchive: false,
      doneColumnCollapsed: false,

      theme: DEFAULT_THEME,

      bulkSelectedTaskIds: [],

      setTheme: (theme) => set({ theme }),
      setSelectedOrgId: (id) =>
        set({
          selectedOrgId: id,
          selectedRepoId: null,
          selectedTaskId: null,
          bulkSelectedTaskIds: [],
        }),
      clearOrgSelection: () =>
        set({
          selectedOrgId: null,
          selectedRepoId: null,
          selectedTaskId: null,
          bulkSelectedTaskIds: [],
        }),
      selectRepo: (id) =>
        set({
          selectedRepoId: id,
          selectedTaskId: null,
          viewMode: 'board',
          bulkSelectedTaskIds: [],
        }),
      selectSeedBox: () =>
        set({
          selectedRepoId: null,
          viewMode: 'seeds',
          selectedTaskId: null,
          bulkSelectedTaskIds: [],
        }),
      selectTask: (id) =>
        set((state) => ({
          selectedTaskId: id,
          viewMode:
            id === null && state.viewMode === 'task-page'
              ? 'board'
              : state.viewMode,
        })),
      openTaskPage: (id) =>
        set({
          selectedTaskId: id,
          viewMode: 'task-page',
          bulkSelectedTaskIds: [],
        }),
      toggleBacklog: () =>
        set((state) => ({ backlogCollapsed: !state.backlogCollapsed })),
      toggleTaskPageDetail: () =>
        set((state) => ({
          taskPageDetailCollapsed: !state.taskPageDetailCollapsed,
        })),
      collapseTaskPage: () => set({ viewMode: 'board' }),
      openSession: (id) =>
        set((state) => ({
          sessionId: id,
          // If a task is selected, switch to the task page view so the
          // session is always shown in the dedicated task page.
          ...(state.selectedTaskId && state.viewMode !== 'task-page'
            ? { viewMode: 'task-page' as const }
            : {}),
        })),
      closeSession: () => set({ sessionId: null }),

      setSearchQuery: (query) =>
        set({ searchQuery: query, bulkSelectedTaskIds: [] }),
      toggleFilterLabel: (labelId) =>
        set((state) => ({
          filterLabelIds: state.filterLabelIds.includes(labelId)
            ? state.filterLabelIds.filter((id) => id !== labelId)
            : [...state.filterLabelIds, labelId],
          bulkSelectedTaskIds: [],
        })),
      clearFilters: () =>
        set({ searchQuery: '', filterLabelIds: [], bulkSelectedTaskIds: [] }),
      toggleArchive: () =>
        set((state) => ({
          showArchive: !state.showArchive,
          bulkSelectedTaskIds: [],
        })),
      toggleDoneCollapsed: () =>
        set((state) => ({
          doneColumnCollapsed: !state.doneColumnCollapsed,
          bulkSelectedTaskIds: [],
        })),

      toggleBulkSelectTask: (id) =>
        set((state) => ({
          bulkSelectedTaskIds: state.bulkSelectedTaskIds.includes(id)
            ? state.bulkSelectedTaskIds.filter((tid) => tid !== id)
            : [...state.bulkSelectedTaskIds, id],
        })),
      bulkSelectAll: (ids) =>
        set((state) => {
          const existing = new Set(state.bulkSelectedTaskIds);
          for (const id of ids) existing.add(id);
          return { bulkSelectedTaskIds: [...existing] };
        }),
      bulkDeselectAll: (ids) =>
        set((state) => {
          const toRemove = new Set(ids);
          return {
            bulkSelectedTaskIds: state.bulkSelectedTaskIds.filter(
              (id) => !toRemove.has(id),
            ),
          };
        }),
      clearBulkSelection: () => set({ bulkSelectedTaskIds: [] }),
    }),
    {
      name: 'holophyte-app',
      version: 1,
      migrate: (persisted) => {
        const state = persisted as Record<string, unknown>;
        if (
          typeof state.theme !== 'string' ||
          !VALID_THEMES.includes(state.theme as ThemeName)
        ) {
          state.theme = DEFAULT_THEME;
        }
        return state as unknown as AppState;
      },
      partialize: (state) => ({
        selectedOrgId: state.selectedOrgId,
        selectedRepoId: state.selectedRepoId,
        viewMode: state.viewMode,
        backlogCollapsed: state.backlogCollapsed,
        taskPageDetailCollapsed: state.taskPageDetailCollapsed,
        showArchive: state.showArchive,
        doneColumnCollapsed: state.doneColumnCollapsed,
        theme: state.theme,
      }),
    },
  ),
);
