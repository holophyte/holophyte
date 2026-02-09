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
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
      {
        extends: true,
        test: {
          environment: "edge-runtime",
          include: ["convex/**/*.{test,spec}.{ts,tsx}"],
          server: { deps: { inline: ["convex-test"] } },
        },
      },
    ],
  },
});
