import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@convex": resolve(__dirname, "convex"),
    },
  },
  test: {
    environment: "jsdom",
    environmentMatchGlobs: [["convex/**", "edge-runtime"]],
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "convex/**/*.{test,spec}.{ts,tsx}",
    ],
    server: { deps: { inline: ["convex-test"] } },
  },
});
