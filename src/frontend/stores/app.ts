import type { Id } from "@convex/_generated/dataModel";
import { create } from "zustand";

type ViewMode = "board" | "seeds";

interface AppState {
  selectedRepoId: Id<"repos"> | null;
  selectedTaskId: Id<"tasks"> | null;
  viewMode: ViewMode;
  backlogCollapsed: boolean;
  terminalSessionId: string | null;
  terminalMinimized: boolean;

  selectRepo: (id: Id<"repos"> | null) => void;
  selectSeedBox: () => void;
  selectTask: (id: Id<"tasks"> | null) => void;
  toggleBacklog: () => void;
  openTerminal: (sessionId: string) => void;
  closeTerminal: () => void;
  toggleTerminalMinimized: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedRepoId: null,
  selectedTaskId: null,
  viewMode: "board",
  backlogCollapsed: false,
  terminalSessionId: null,
  terminalMinimized: false,

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
}));
