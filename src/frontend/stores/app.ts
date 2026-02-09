import type { Id } from "@convex/_generated/dataModel";
import { create } from "zustand";

interface AppState {
  selectedRepoId: Id<"repos"> | null;
  selectedTaskId: Id<"tasks"> | null;
  terminalSessionId: string | null;
  terminalMinimized: boolean;

  selectRepo: (id: Id<"repos"> | null) => void;
  selectTask: (id: Id<"tasks"> | null) => void;
  openTerminal: (sessionId: string) => void;
  closeTerminal: () => void;
  toggleTerminalMinimized: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedRepoId: null,
  selectedTaskId: null,
  terminalSessionId: null,
  terminalMinimized: false,

  selectRepo: (id) => set({ selectedRepoId: id }),
  selectTask: (id) => set({ selectedTaskId: id }),
  openTerminal: (sessionId) =>
    set({ terminalSessionId: sessionId, terminalMinimized: false }),
  closeTerminal: () =>
    set({ terminalSessionId: null, terminalMinimized: false }),
  toggleTerminalMinimized: () =>
    set((state) => ({ terminalMinimized: !state.terminalMinimized })),
}));
