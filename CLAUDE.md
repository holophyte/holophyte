# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Holophyte?

Project management app for running parallel Claude Code sessions. A kanban board UI lets you create tasks with prompts, launch Claude Code sessions via the Agent SDK per task, and stream structured events to the browser via WebSocket.

## Development Principles

- **KISS** — Write simple, readable code over clever solutions. Prefer straightforward implementations that are easy to understand and maintain.
- **DRY** — Eliminate code duplication through shared utilities and components. Use existing patterns from `src/frontend/lib/`, `src/frontend/hooks/`, and `src/frontend/components/`.
- **Do what was asked; nothing more, nothing less** — Avoid over-engineering, premature optimization, and unsolicited refactoring.

## Commands

```bash
bun run dev              # Start server with HMR (port 8080)
bun run dev:all          # App server + cloud Convex dev (port 8080)
bun run dev:local        # App server + local Convex (reads .dev-ports)
bun run convex:dev       # Start cloud Convex dev
bun run convex:local     # Start local Convex backend (reads .dev-ports)
bun run test             # Run unit tests (vitest)
bun run test:ui          # Vitest UI dashboard
bun run test:e2e         # Playwright E2E tests (requires convex:dev running)
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run check            # lint + typecheck + test (all-in-one)
bun run convex:deploy    # Deploy Convex to production
bun run worktree:create <name>  # Create worktree with isolated local Convex
bun run pr-comments      # Show Greptile PR comments (--poll for polling)
```

Single test file: `bunx vitest run src/claude/manager.test.ts`

## Runtime

Use **Bun** for everything — never Node.js, npm, vite, or express. Bun auto-loads `.env` files.

- `Bun.serve()` for HTTP + WebSocket (not express)
- `Bun.file()` over `node:fs` readFile/writeFile
- `Bun.$\`cmd\`` over execa
- `bun install`, `bun run`, `bunx` over npm/yarn/pnpm equivalents
- HTML imports with `Bun.serve()` for frontend bundling (not vite/webpack)

## Code Style

Enforced by **Biome** (no ESLint/Prettier). Run `bun run lint:fix` before committing.

- 2 spaces, single quotes, semicolons always
- Default exports for React components; named exports for everything else
- PascalCase component files (`TaskCard.tsx`), camelCase for non-component modules
- Props typed with `interface ComponentNameProps`
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on)
- Combine classNames with `cn()` helper from `@/frontend/lib/utils` (clsx + tailwind-merge)

**Import ordering** (top to bottom):
1. External type imports (`import type { Doc } from '@convex/_generated/dataModel'`)
2. External value imports (`import { useQuery } from 'convex/react'`)
3. Internal type imports (`import type { Session } from '@/claude/manager'`)
4. Internal value imports — `@/` aliases (`import { cn } from '@/frontend/lib/utils'`)
5. Relative imports (`import Badge from './ui/Badge'`)

## TypeScript

Strict mode with additional checks:
- `noUncheckedIndexedAccess: true` — array/object indexing returns `T | undefined`
- `noImplicitOverride: true`
- `noFallthroughCasesInSwitch: true`

## Architecture

```
src/server.ts              → Bun.serve() with routes + WebSocket handler
src/claude/manager.ts      → Claude Agent SDK session management (spawn/stop/approve)
src/frontend/index.tsx     → React entry, Convex client setup
src/frontend/App.tsx       → Main layout: Sidebar | KanbanBoard + SessionPanel | TaskDetailPanel
src/frontend/stores/app.ts → Zustand store (selected repo/task, session state)
src/frontend/hooks/        → useSession (WebSocket + SDK event state)
src/frontend/components/   → UI components (Kanban*, Task*, Session*, Sidebar, dialogs)
src/frontend/components/ui → Radix UI primitives (Button, Dialog, Input, etc.)
convex/schema.ts           → Data model: repos, tasks, sessions
convex/{repos,tasks,sessions}.ts → Convex queries and mutations
scripts/                   → Shared shell scripts (convex-local, dev-local, worktree-create, pr-comments)
.githooks/pre-commit       → Pre-commit hook (codegen + lint + typecheck)
```

**Data flow for SDK sessions:**
1. Frontend POSTs to `/api/sessions/start` with taskId + prompt + model
2. Server spawns Claude Code via Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
3. Frontend opens WebSocket to `/ws/session/:sessionId`
4. SDK events → `consumeIterator()` → WebSocket → SessionPanel conversation UI in browser
5. User approvals → WebSocket → `respondToApproval()` → SDK resumes

**Path aliases:** `@/*` → `./src/*`, `@convex/*` → `./convex/*`

## Convex (Real-time Database)

- Three tables: `repos`, `tasks` (with kanban statuses), `sessions`
- Repo/task deletions cascade manually (repo → tasks → sessions)
- All functions use object-style with `args` (validated with `v` from `convex/values`) and `handler`
- Timestamps stored as `v.number()` using `Date.now()`
- Indexes named descriptively: `by_repo_status`, `by_task`, `by_path`
- Import generated types: `import type { Doc, Id } from "@convex/_generated/dataModel"`
- Convex URL is served via `/api/config` endpoint because browser bundles can't access env vars
- Schema changes that conflict with existing data block deployment. To fix: temporarily remove `schema.ts`, deploy with `--typecheck=disable`, clear data, restore schema.

**Local-first development:**
- Development uses local Convex backends — each workspace (main repo + worktrees) gets its own isolated instance
- Ports and project identity configured in `.dev-ports` (gitignored, per-workspace):
  ```
  DEV_PORT=8080
  CONVEX_CLOUD_PORT=3210
  CONVEX_SITE_PORT=3211
  CONVEX_TEAM=ko-vial
  CONVEX_PROJECT=holophyte
  ```
- `CONVEX_TEAM`/`CONVEX_PROJECT` are needed to switch from cloud to local deployment — `convex dev --local` silently connects to cloud if `.env.local` has a `dev:` deployment without these
- Main repo: dev=8080, convex=3210/3211. Worktrees get auto-assigned ports via `bun run worktree:create`
- `bun run dev:local` starts app server + local Convex from `.dev-ports`
- `bun run convex:dev` (cloud) is still available for production deployment workflows
- `.env.local` is managed by `convex dev` — scripts auto-reconfigure from cloud to local when needed

## Frontend Patterns

- **React 19** with Convex `useQuery`/`useMutation` for real-time data
- **Zustand** for UI-only state — persists `selectedRepoId`, `viewMode`, `backlogCollapsed` to localStorage (key: `"holophyte-app"`)
- **Zustand selectors**: always use inline selectors for minimal re-renders: `useAppStore((s) => s.selectTask)`
- **Tailwind v4** via CSS-first config in `src/frontend/styles.css` (`@theme inline {}` block) — no `tailwind.config.ts`
- **Radix UI** (umbrella `radix-ui` package) + class-variance-authority for component variants
- **Icons**: `lucide-react`
- **react-markdown** + rehype-highlight for rendered message content

## Testing

**Unit tests (Vitest):**
- Test globals enabled — no need to import `describe`/`it`/`expect`
- Default environment: `jsdom` (frontend), `edge-runtime` (convex/)
- Override per-file with `// @vitest-environment node` at top
- Convex tests use `convex-test`: `const t = convexTest(schema);`
- Tests co-located with source: `manager.ts` → `manager.test.ts`

**E2E tests (Playwright):**
- Tests in `e2e/` directory, pattern `*.spec.ts`
- Chromium only, base URL `http://localhost:8080`
- Auto-starts the dev server, but **`bun run convex:dev` must be running separately**
- Use `waitForApp(page)` helper to wait for hydration before assertions

## Error Handling

**Server routes** (`src/server.ts`): Catch errors and return structured JSON responses. Always log with `console.error` before returning a 500.
```typescript
try {
  // ...
  return Response.json(result);
} catch (err) {
  console.error("Failed to do X:", err);
  return Response.json({ error: String(err) }, { status: 500 });
}
```

**Convex functions**: Throw descriptive `Error` messages — Convex surfaces these to the client. No try/catch needed around database operations (Convex handles transactions).
```typescript
const task = await ctx.db.get(args.id);
if (!task) throw new Error("Task not found");
```

**Frontend**: Convex `useMutation` errors surface via the Convex error boundary. For API calls to the Bun server, catch and display via UI state.

## Logging

Use `console.error` for errors that need attention in server-side code. Use `console.log` sparingly — only for startup messages and significant lifecycle events (server start, session spawn/exit). No logging in Convex functions (Convex has its own dashboard logging). No `console.log` in frontend code (use React DevTools / Convex dashboard instead).

## Constants

Extract shared values to avoid magic numbers and duplicated strings:
- **Task/session statuses**: Import `taskStatusValidator` from `convex/schema.ts` — don't redeclare status literals elsewhere
- **Default model**: Import `DEFAULT_MODEL` from `src/constants.ts` — shared between backend and frontend

## Configuration

Server configuration lives in environment variables with sensible defaults:
- `PORT` (default: `8080`) — server port
- `CONVEX_URL` — Convex deployment URL (served to frontend via `/api/config`)
- `SHELL` (default: `/bin/zsh`) — login shell for environment resolution
- `CONVEX_DEPLOYMENT` — managed by `convex dev` in `.env.local`

## Git Workflow

- **Features/refactors**: Use worktrees (`/worktree` skill) for parallel development on `feat/<name>` branches
- **Quick fixes**: Work directly on a branch from main — no worktree needed
- Worktrees are for multi-file features you want to run in parallel, not for every change

## Commit Guidelines

- Pre-commit hooks run automatically: `convex codegen` → `lint` → `typecheck`
- Pre-commit hooks are mandatory for AI agents. Never use `--no-verify` or `--no-gpg-sign` to skip hooks.
- Run `bun run lint:fix` to auto-fix lint issues before committing
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
- Commit frequently with descriptive messages — incremental changes over large batches
- Stage specific files rather than `git add .`

## Key Gotchas

- Bun.serve() route handlers need explicit `Request` type annotation in strict mode
- Bun.serve() generic `<WsData>` types the `ws.data` object
- Biome doesn't understand CSS `theme()` function — use `var()` instead
- `useSemanticElements` biome rule is set to "warn" (kanban board needs div-based drag-drop)
- `bunfig.toml` configures `bun-plugin-tailwind` under `[serve.static]`
- Pre-commit hooks configured via `.githooks/` — `prepare` script in package.json sets `core.hooksPath` on `bun install`
- No CI/CD or Docker configured
