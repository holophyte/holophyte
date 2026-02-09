import { create } from "zustand";
import { devtools, persist } from "zustand/middleware";

interface AppState {
  theme: "light" | "dark";
  sidebarOpen: boolean;
  setTheme: (theme: "light" | "dark") => void;
  toggleSidebar: () => void;
}

function applyThemeClass(theme: "light" | "dark") {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        theme: "dark",
        sidebarOpen: true,
        setTheme: (theme) => {
          applyThemeClass(theme);
          set({ theme });
        },
        toggleSidebar: () =>
          set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      }),
      {
        name: "app-storage",
        onRehydrateStorage: () => (state) => {
          if (state?.theme) {
            applyThemeClass(state.theme);
          }
        },
      },
    ),
  ),
);
