# CLAUDE.md

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the CLAUDE.md file to help prevent future agents from having the same issue.

## What is Holophyte?

Project management app for running parallel Claude Code sessions. A kanban board UI lets you create tasks with prompts, launch Claude Code sessions via the Agent SDK per task, and stream structured events to the browser via Convex real-time queries.

## Development Principles

- **KISS** — Write simple, readable code over clever solutions. Prefer straightforward implementations that are easy to understand and maintain.
- **DRY** — Eliminate code duplication through shared utilities and components. Use existing patterns from `src/frontend/lib/`, `src/frontend/hooks/`, and `src/frontend/components/`.
- **Do what was asked; nothing more, nothing less** — Avoid over-engineering, premature optimization, and unsolicited refactoring.
- **Challenge proposals, not instructions** — When the developer proposes a technical choice, product decision, or strategic direction (e.g. "Should we use X?", "I'm thinking of doing Y"): don't default to agreement. Identify reasoning flaws, implicit assumptions, and blind spots. If the reasoning is weak, break it down and show why. When the developer is clearly directing execution (e.g. "Add field Z to the schema"), just execute. Contrarianism isn't authenticity — only push back when you have substantive reasoning behind it.

## Commands

```bash
bun run dev              # Start server with HMR (port 8080)
bun run dev:all          # App server + cloud Convex dev (port 8080)
bun run dev:local        # App server + local Convex (reads .dev-ports)
bun run convex:dev       # Start cloud Convex dev
bun run convex:local     # Start local Convex backend (reads .dev-ports)
bun run test             # Run unit tests (vitest)
bun run test:ui          # Vitest UI dashboard
bun run test:e2e         # Playwright E2E tests (ephemeral Convex, fully self-contained)
bun run test:e2e:isolated # E2E in a temp worktree (doesn't touch dev .env.local)
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run check            # lint + typecheck + test (all-in-one)
bun run convex:deploy    # Deploy Convex to production
bun run worktree:create <name>  # Create worktree with isolated local Convex
bun run worktree:cleanup <name> # Remove worktree, branch, and directory (--list, --stale)
bun run pr-comments      # Show unresolved PR review comments (--all, --poll, --resolve)
```

Single test file: `bunx vitest run src/claude/manager.test.ts`

## Runtime

Use **Bun** for everything — never Node.js, npm, vite, or express. Bun auto-loads `.env` files.

- `Bun.serve()` for HTTP (not express)
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
src/server.ts              → Bun.serve() with routes (auth proxy, directory picker, config)
src/claude/manager.ts      → Claude Agent SDK session management (spawn/stop/approve)
src/server/polling.ts      → Companion polling logic (reads from Convex, processes sessions)
src/frontend/index.tsx     → React entry, Convex client setup
src/frontend/App.tsx       → Main layout: Sidebar | KanbanBoard + SessionPanel | TaskDetailPanel
src/frontend/stores/app.ts → Zustand store (selected repo/task, session state)
src/frontend/hooks/        → useSession (Convex real-time subscriptions for session events)
src/frontend/components/   → UI components (Kanban*, Task*, Session*, Sidebar, dialogs)
src/frontend/components/ui → Radix UI primitives (Button, Dialog, Input, etc.)
convex/schema.ts           → Data model (14 tables + auth tables)
convex/*.ts                → Convex queries and mutations
scripts/                   → Shared shell scripts (convex-local, dev-local, worktree-create, pr-comments)
.githooks/pre-commit       → Pre-commit hook (codegen + stage + lint + typecheck)
```

**Data flow for SDK sessions:**
1. Frontend calls Convex mutation `api.sessions.create` with taskId + prompt + model
2. Companion process spawns Claude Code via Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
3. SDK events are persisted to Convex `sessionEvents` table via `consumeIterator()` → `bufferEvent()` → Convex mutations
4. Frontend subscribes to session events via `useSession()` hook using Convex real-time queries
5. User approvals resolve via Convex mutation `api.pendingApprovals.resolve()` → companion reads and resumes SDK

**Frontend ↔ backend communication:** Frontend communicates with the backend through Convex mutations/queries — no direct fetch() calls to localhost. The companion process polls Convex for work via internal HTTP endpoints. When adding new features that need backend interaction, create a Convex mutation and call it from the frontend with useMutation/useAction. The exception is operations that require local machine access (directory picker, filesystem operations, etc.) — those go through the companion's local API.

**Path aliases:** `@/*` → `./src/*`, `@convex/*` → `./convex/*`

## Convex (Real-time Database)

- Multi-tenant with orgs; repos scoped to `orgId`; tasks/sessions cascade through repo
- Repo/task/session deletions cascade manually
- All functions use object-style with `args` (validated with `v` from `convex/values`) and `handler`
- Timestamps stored as `v.number()` using `Date.now()`
- Indexes named descriptively: `by_repo_status`, `by_task`, `by_path`
- Import generated types: `import type { Doc, Id } from "@convex/_generated/dataModel"`
- Convex URL is served via `/api/config` endpoint because browser bundles can't access env vars
- **Adding fields to existing tables**: Use `v.optional()` in the schema to avoid blocking deploys, even if the field is logically required. Mark with a `// required` comment to distinguish from truly optional fields. Enforce the requirement in `args` validators and always set the field in mutations. New tables should use required fields since there's no existing data to conflict with.
  ```typescript
  // schema.ts
  orgId: v.optional(v.id('organizations')), // required — added to existing table

  // mutations — args validator enforces the requirement
  args: { orgId: v.id('organizations') }
  ```
- **Schema tightening**: Optionally tighten `v.optional()` → required in a follow-up once all docs have the field. Verify with a one-off query before deploying.
- **Dev escape hatch**: If a local Convex backend gets into a broken state, you can temporarily remove `schema.ts`, deploy with `--typecheck=disable`, clear data, and restore. Never use this on prod.

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
- **Deployment isolation**: Each workspace gets a unique `CONVEX_DEPLOYMENT` name. `convex-local.sh` validates that `CONVEX_URL` ports match `.dev-ports` and auto-reconfigures on mismatch
- See `docs/docs/local-development.md` for the full worktree guide and gotchas

## Frontend Patterns

- **Minimize `useEffect`** — Follow [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). Only use `useEffect` for synchronizing with external systems (DOM APIs, timers, keyboard listeners). Do NOT use `useEffect` for:
  - **Deriving state**: Compute during render or use `useMemo` instead of `setState` inside an effect
  - **Event responses**: Put logic in the event handler that triggers it, not in an effect that watches for the result
  - **Resetting state on prop change**: Use the `key` prop to reset component state instead of `useEffect` + `setState`
  - **Initializing state**: Use `useState(initialValue)` or lazy initializers, not `useEffect(fn, [])`
  - **Notifying parents**: Call parent callbacks in event handlers, not in effects reacting to state changes
  - **Data fetching**: Use Convex `useQuery` (already reactive) — never `fetch` inside `useEffect`
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
- `bun run test:e2e` — fully self-contained, spins up an ephemeral Convex backend automatically. Each run gets a fresh database — no cleanup needed
- Dev Convex (`bun run convex:local`) must NOT be running — use `bun run test:e2e:isolated` to avoid stopping it
- Use `waitForApp(page)` helper to wait for hydration before assertions
- **E2E auth**: `AutoTestAuth` auto-signs-in with `dev@holophyte.test` / `password` (same credentials as `seed-dev-user.sh`, shared via `DEV_USER_EMAIL`/`DEV_USER_PASSWORD` in `src/constants.ts`). On fresh DB, falls back to sign-up. Password auth avoids the stale refresh token problem that anonymous auth had — re-authenticating always returns the same user.
- Runs on CI automatically via `.github/workflows/e2e.yml` using `CONVEX_AGENT_MODE=anonymous` (no secrets needed). `CONVEX_DEPLOY_KEY` must NOT be in the env — it overrides local mode
- **Manual testing**: when `ALLOW_PASSWORD_AUTH=1` is set, auto-login as `dev@holophyte.test` happens automatically on any page load. Use `?signin` to suppress auto-login and see the sign-in page.
- See `docs/docs/testing/playwright-manual.md` for the full guide

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

- Pre-commit hooks run automatically: `convex codegen` → `git add convex/_generated/` → `lint` → `typecheck`
- Pre-commit hooks are mandatory for AI agents. Never use `--no-verify` or `--no-gpg-sign` to skip hooks.
- Run `bun run lint:fix` to auto-fix lint issues before committing
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
- **Commits MUST be atomic** — one logical change per commit. Each commit should be independently understandable and revertable. Examples of good atomic commits: a schema change, then its backend handler, then its frontend component. Bad: bundling a feature + docs update + lint fix into one commit.
- Commit frequently with descriptive messages — incremental changes over large batches. Don't save all changes for one big commit at the end.
- Stage specific files rather than `git add .`

## Key Gotchas

- **`convex/_generated/` is committed** — Convex codegen can't run in CI/Vercel, so generated types are checked into git. The pre-commit hook auto-runs codegen and stages the output. If you change `convex/schema.ts` or Convex functions, the hook keeps `_generated/` in sync.
- Bun.serve() route handlers need explicit `Request` type annotation in strict mode
- Bun.serve() generic type parameter types the server's context data
- Biome doesn't understand CSS `theme()` function — use `var()` instead
- `useSemanticElements` biome rule is set to "warn" (kanban board needs div-based drag-drop)
- `bunfig.toml` configures `bun-plugin-tailwind` under `[serve.static]`
- Pre-commit hooks configured via `.githooks/` — `prepare` script in package.json sets `core.hooksPath` on `bun install`
- `bun run --watch` swallows subprocess stderr — run `bun src/server.ts` directly when debugging SDK session issues
- **`CONVEX_DEPLOY_KEY` overrides `--dev-deployment local`** — if set in the environment, `convex dev --configure existing --dev-deployment local` silently provisions a cloud deployment instead. E2E scripts unset it before provisioning.
- **`CONVEX_AGENT_MODE=anonymous`** — undocumented Convex CLI env var that enables anonymous local development without login prompts. Required for CI/non-interactive environments. Beta feature per CLI output.
- **`convex dev --local` silently connects to cloud** if `.dev-ports` is missing `CONVEX_TEAM`/`CONVEX_PROJECT` — always include both
- **Stop `convex:local` before running E2E tests** — `bun run test:e2e` spins up its own ephemeral Convex; the CLI refuses to provision if another local backend is active. Alternatively, use `bun run test:e2e:isolated` which runs in a temp worktree and doesn't touch the main repo's `.env.local`
- **Manual testing requires `ALLOW_PASSWORD_AUTH=1`** on Convex env — `bunx convex env set ALLOW_PASSWORD_AUTH 1` (auto-set by `worktree:create` for new worktrees). When set, auto-login as `dev@holophyte.test` happens on any page load. Use `?signin` to suppress auto-login and see the sign-in page. `ALLOW_ANONYMOUS_AUTH` is still set as a fallback for the MCP server.
- **`bunx @convex-dev/auth` needs a running backend** — start `convex:local` first, then run auth setup in another terminal
- See `docs/docs/local-development.md` for the full worktree guide and troubleshooting
