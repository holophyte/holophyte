import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../app";

describe("useAppStore", () => {
  afterEach(() => {
    // Reset store to defaults between tests
    useAppStore.setState({ theme: "dark", sidebarOpen: true });
  });

  it("has correct default state", () => {
    const state = useAppStore.getState();
    expect(state.theme).toBe("dark");
    expect(state.sidebarOpen).toBe(true);
  });

  it("setTheme updates the theme", () => {
    useAppStore.getState().setTheme("light");
    expect(useAppStore.getState().theme).toBe("light");

    useAppStore.getState().setTheme("dark");
    expect(useAppStore.getState().theme).toBe("dark");
  });

  it("setTheme applies dark class to documentElement", () => {
    useAppStore.getState().setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    useAppStore.getState().setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("toggleSidebar toggles sidebarOpen", () => {
    expect(useAppStore.getState().sidebarOpen).toBe(true);

    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(false);

    useAppStore.getState().toggleSidebar();
    expect(useAppStore.getState().sidebarOpen).toBe(true);
  });
});
