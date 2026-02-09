import type { Id } from "@convex/_generated/dataModel";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type ViewMode = "board" | "seeds";

interface AppState {
  selectedRepoId: Id<"repos"> | null;
  selectedTaskId: Id<"tasks"> | null;
  viewMode: ViewMode;
  backlogCollapsed: boolean;
  terminalSessionId: string | null;
  terminalMinimized: boolean;

  // Search and filter state
  searchQuery: string;
  filterLabelIds: Id<"labels">[];
  showArchive: boolean;
  doneColumnCollapsed: boolean;

  selectRepo: (id: Id<"repos"> | null) => void;
  selectSeedBox: () => void;
  selectTask: (id: Id<"tasks"> | null) => void;
  toggleBacklog: () => void;
  openTerminal: (sessionId: string) => void;
  closeTerminal: () => void;
  toggleTerminalMinimized: () => void;

  // Search and filter actions
  setSearchQuery: (query: string) => void;
  toggleFilterLabel: (labelId: Id<"labels">) => void;
  clearFilters: () => void;
  toggleArchive: () => void;
  toggleDoneCollapsed: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      selectedRepoId: null,
      selectedTaskId: null,
      viewMode: "board",
      backlogCollapsed: true,
      terminalSessionId: null,
      terminalMinimized: false,

      searchQuery: "",
      filterLabelIds: [],
      showArchive: false,
      doneColumnCollapsed: false,

      selectRepo: (id) => set({ selectedRepoId: id, viewMode: "board" }),
      selectSeedBox: () =>
        set({ selectedRepoId: null, viewMode: "seeds", selectedTaskId: null }),
      selectTask: (id) => set({ selectedTaskId: id }),
      toggleBacklog: () =>
        set((state) => ({ backlogCollapsed: !state.backlogCollapsed })),
      openTerminal: (sessionId) =>
        set({ terminalSessionId: sessionId, terminalMinimized: false }),
      closeTerminal: () =>
        set({ terminalSessionId: null, terminalMinimized: false }),
      toggleTerminalMinimized: () =>
        set((state) => ({ terminalMinimized: !state.terminalMinimized })),

      setSearchQuery: (query) => set({ searchQuery: query }),
      toggleFilterLabel: (labelId) =>
        set((state) => ({
          filterLabelIds: state.filterLabelIds.includes(labelId)
            ? state.filterLabelIds.filter((id) => id !== labelId)
            : [...state.filterLabelIds, labelId],
        })),
      clearFilters: () => set({ searchQuery: "", filterLabelIds: [] }),
      toggleArchive: () =>
        set((state) => ({ showArchive: !state.showArchive })),
      toggleDoneCollapsed: () =>
        set((state) => ({ doneColumnCollapsed: !state.doneColumnCollapsed })),
    }),
    {
      name: "holophyte-app",
      partialize: (state) => ({
        selectedRepoId: state.selectedRepoId,
        viewMode: state.viewMode,
        backlogCollapsed: state.backlogCollapsed,
        showArchive: state.showArchive,
        doneColumnCollapsed: state.doneColumnCollapsed,
      }),
    },
  ),
);
