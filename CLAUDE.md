# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Holophyte?

Project management app for running parallel Claude Code sessions. A kanban board UI lets you create tasks with prompts, launch Claude Code in PTY terminals per task, and stream output to the browser via WebSocket.

## Commands

```bash
bun run dev              # Start server with HMR (port 3000)
bun run convex:dev       # Start Convex local dev (run alongside dev server)
bun run test             # Run unit tests (vitest)
bun run test:ui          # Vitest UI dashboard
bun run test:e2e         # Playwright E2E tests
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run convex:deploy    # Deploy Convex to production
```

To run a single test file: `bunx vitest run src/claude/manager.test.ts`

## Runtime

Use **Bun** for everything — never Node.js, npm, vite, or express. Bun auto-loads `.env` files.

- `Bun.serve()` for HTTP + WebSocket (not express)
- `Bun.file()` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` over execa
- `bun install`, `bun run`, `bunx` over npm/yarn/pnpm equivalents
- HTML imports with `Bun.serve()` for frontend bundling (not vite/webpack)

## Architecture

```
src/server.ts              → Bun.serve() with routes + WebSocket handler
src/claude/manager.ts      → PTY process management (spawn/stop/resize Claude Code)
src/frontend/index.tsx     → React entry, Convex client setup
src/frontend/App.tsx       → Main layout: Sidebar | KanbanBoard + TerminalPanel | TaskDetailPanel
src/frontend/stores/app.ts → Zustand store (selected repo/task, terminal state)
src/frontend/hooks/        → useTerminal (xterm.js + WebSocket)
src/frontend/components/   → UI components (Kanban*, Task*, Terminal*, Sidebar, dialogs)
src/frontend/components/ui → Radix UI primitives (button, dialog, input, etc.)
convex/schema.ts           → Data model: repos, tasks, sessions
convex/{repos,tasks,sessions}.ts → Convex queries and mutations
```

**Data flow for terminal sessions:**
1. Frontend POSTs to `/api/sessions/start` with taskId + prompt
2. Server spawns Claude Code via Bun native PTY (`Bun.spawn` with `terminal` option)
3. Frontend opens WebSocket to `/ws/terminal/:sessionId`
4. PTY output → `data` callback → WebSocket → xterm.js in browser
5. User terminal input → WebSocket → `proc.terminal.write()` → PTY

**Path aliases:** `@/*` → `./src/*`, `@convex/*` → `./convex/*`

## Convex (Real-time Database)

- Three tables: `repos`, `tasks` (with kanban statuses), `sessions`
- Repo/task deletions cascade (repo → tasks → sessions)
- Convex URL is served via `/api/config` endpoint because browser bundles can't access env vars
- `.env.local` is managed by `convex dev` — only contains `CONVEX_DEPLOYMENT`
- Schema changes that conflict with existing data block deployment. To fix: temporarily remove `schema.ts`, deploy with `--typecheck=disable`, clear data, restore schema.

## Frontend Stack

- **React 19** with Convex `useQuery`/`useMutation` for real-time data
- **Zustand** for UI-only state (selections, terminal panel visibility)
- **Tailwind v4** via CSS-first config in `src/frontend/styles.css` (`@theme inline {}` block) — no `tailwind.config.ts`
- **Radix UI** + class-variance-authority for component primitives
- **xterm.js** + FitAddon for terminal rendering

## Key Gotchas

- Bun native PTY: `proc.stdin`/`proc.stdout`/`proc.stderr` are all `null` when using `terminal` option — use the `data` callback for output and `proc.terminal.write()` for input
- `node-pty` does NOT work with Bun — always use Bun's native PTY
- Bun.serve() route handlers need explicit `Request` type annotation in strict mode
- Bun.serve() generic `<WsData>` types the `ws.data` object
- Biome doesn't understand CSS `theme()` function — use `var()` instead
- `useSemanticElements` biome rule is set to "warn" (kanban board needs div-based drag-drop)
- `bunfig.toml` configures `bun-plugin-tailwind` under `[serve.static]`
