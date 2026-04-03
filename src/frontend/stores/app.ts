import type { Id } from '@convex/_generated/dataModel';
import { TaskStatus } from '@convex/schema';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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

const DEFAULT_COLLAPSED_COLUMNS = new Set<string>([TaskStatus.Backlog]);

const storage = createJSONStorage(() => localStorage, {
  replacer: (_key, value) => {
    if (value instanceof Set) {
      return { __type: 'Set', values: [...value] };
    }
    return value;
  },
  reviver: (_key, value) => {
    if (
      value &&
      typeof value === 'object' &&
      '__type' in value &&
      value.__type === 'Set' &&
      'values' in value &&
      Array.isArray(value.values)
    ) {
      return new Set(
        value.values.filter((item): item is string => typeof item === 'string'),
      );
    }
    return value;
  },
});

interface AppState {
  selectedOrgId: Id<'organizations'> | null;
  collapsedColumns: Set<string>;
  taskPageDetailCollapsed: boolean;
  /** The Convex session ID currently displayed in `SessionPanel`. `null` means no session is open. */
  activeSessionId: string | null;

  // Search and filter state
  searchQuery: string;
  filterLabelIds: Id<'labels'>[];
  showArchive: boolean;

  // Theme
  theme: ThemeName;

  // Last repo used when creating a task from the "All Tasks" view
  lastUsedRepoId: Id<'repos'> | null;

  // Sidebar
  sidebarCollapsed: boolean;

  // Bulk selection state
  bulkSelectedTaskIds: Id<'tasks'>[];

  setLastUsedRepoId: (id: Id<'repos'>) => void;
  setTheme: (theme: ThemeName) => void;
  setSelectedOrgId: (id: Id<'organizations'>) => void;
  clearOrgSelection: () => void;
  toggleColumnCollapsed: (columnId: string) => void;
  toggleBacklog: () => void;
  toggleTaskPageDetail: () => void;
  /** Sets the active session ID. Navigation to the task page is handled by the router. */
  openSession: (sessionId: string) => void;
  /**
   * Switches which session is displayed in `SessionPanel` without changing the
   * view mode.
   *
   * Use this for the session dropdown — the user is already on the task page
   * and is simply choosing a different session to view.
   */
  switchSession: (sessionId: string | null) => void;
  /** Clears the active session, hiding `SessionPanel`. */
  closeSession: () => void;

  // Search and filter actions
  setSearchQuery: (query: string) => void;
  toggleFilterLabel: (labelId: Id<'labels'>) => void;
  clearFilters: () => void;
  toggleArchive: () => void;

  // Sidebar actions
  toggleSidebar: () => void;

  // Bulk selection actions
  toggleBulkSelectTask: (id: Id<'tasks'>) => void;
  bulkSelectAll: (ids: Id<'tasks'>[]) => void;
  bulkDeselectAll: (ids: Id<'tasks'>[]) => void;
  clearBulkSelection: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      selectedOrgId: null,
      collapsedColumns: new Set(DEFAULT_COLLAPSED_COLUMNS),
      taskPageDetailCollapsed: false,
      activeSessionId: null,

      searchQuery: '',
      filterLabelIds: [],
      showArchive: false,

      theme: DEFAULT_THEME,

      lastUsedRepoId: null,

      sidebarCollapsed: false,

      bulkSelectedTaskIds: [],

      setLastUsedRepoId: (id) => set({ lastUsedRepoId: id }),
      setTheme: (theme) => set({ theme }),
      setSelectedOrgId: (id) =>
        set({
          selectedOrgId: id,
          bulkSelectedTaskIds: [],
        }),
      clearOrgSelection: () =>
        set({
          selectedOrgId: null,
          bulkSelectedTaskIds: [],
        }),
      toggleColumnCollapsed: (columnId) =>
        set((state) => {
          const collapsedColumns = new Set(state.collapsedColumns);
          if (collapsedColumns.has(columnId)) {
            collapsedColumns.delete(columnId);
            return { collapsedColumns };
          }
          collapsedColumns.add(columnId);
          return { collapsedColumns, bulkSelectedTaskIds: [] };
        }),
      toggleBacklog: () => get().toggleColumnCollapsed(TaskStatus.Backlog),
      toggleTaskPageDetail: () =>
        set((state) => ({
          taskPageDetailCollapsed: !state.taskPageDetailCollapsed,
        })),
      openSession: (id) => set({ activeSessionId: id }),
      switchSession: (id) => set({ activeSessionId: id }),
      closeSession: () => set({ activeSessionId: null }),

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

      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

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
      storage,
      version: 5,
      migrate: (persisted) => {
        const state = persisted as Record<string, unknown>;
        const collapsedColumns = new Set<string>();
        if (state.collapsedColumns instanceof Set) {
          for (const value of state.collapsedColumns) {
            if (typeof value === 'string') {
              collapsedColumns.add(value);
            }
          }
        } else if (Array.isArray(state.collapsedColumns)) {
          for (const value of state.collapsedColumns) {
            if (typeof value === 'string') {
              collapsedColumns.add(value);
            }
          }
        } else if (state.backlogCollapsed === true) {
          collapsedColumns.add(TaskStatus.Backlog);
        }
        state.collapsedColumns = collapsedColumns;
        if (
          typeof state.theme !== 'string' ||
          !VALID_THEMES.includes(state.theme as ThemeName)
        ) {
          state.theme = DEFAULT_THEME;
        }
        // Remove keys no longer persisted or managed by router
        delete state.selectedOrgId;
        delete state.selectedRepoId;
        delete state.selectedTaskId;
        delete state.viewMode;
        delete state.backlogCollapsed;
        delete state.doneColumnCollapsed;
        // Default sidebarCollapsed for users upgrading from v3 or earlier
        if (typeof state.sidebarCollapsed !== 'boolean') {
          state.sidebarCollapsed = false;
        }
        return state as unknown as AppState;
      },
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns,
        taskPageDetailCollapsed: state.taskPageDetailCollapsed,
        sidebarCollapsed: state.sidebarCollapsed,
        showArchive: state.showArchive,
        lastUsedRepoId: state.lastUsedRepoId,
        theme: state.theme,
      }),
    },
  ),
);
