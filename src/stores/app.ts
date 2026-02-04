import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface AppState {
  theme: "light" | "dark";
  sidebarOpen: boolean;
  setTheme: (theme: "light" | "dark") => void;
  toggleSidebar: () => void;
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        theme: "dark",
        sidebarOpen: true,
        setTheme: (theme) => set({ theme }),
        toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      }),
      {
        name: "app-storage",
      }
    )
  )
);
