# Holophyte

**Project management app for running parallel Claude Code sessions.**

Holophyte is a kanban board application that lets you create tasks with prompts, launch Claude Code sessions via the Agent SDK per task, and stream structured events to your browser via Convex real-time queries.

## Features

- **Kanban Board UI** — Organize tasks across customizable workflow states
- **Session Per Task** — Each task spawns its own Claude Code session via the Agent SDK
- **Real-time Streaming** — Convex-powered structured SDK events rendered in an assistant-ui conversation UI
- **Real-time Database** — Convex provides instant synchronization across all clients
- **Parallel Development** — Git worktrees for isolated feature branches with per-workspace local Convex backends

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/) — Fast JavaScript runtime with native TypeScript support
- **Frontend:** [React 19](https://react.dev/) + [Zustand](https://zustand.docs.pmnd.rs/) (state management)
- **Backend:** Bun.serve() with routes + companion polling
- **Database:** [Convex](https://convex.dev/) — Real-time database with automatic synchronization
- **Sessions:** [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) (`@anthropic-ai/claude-agent-sdk`) + [assistant-ui](https://www.assistant-ui.com/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/) (CSS-first config)
- **UI Components:** [Radix UI](https://www.radix-ui.com/)
- **Icons:** [Lucide React](https://lucide.dev/)

## Prerequisites

- [Bun](https://bun.sh/) v1.3.5+
- [Convex CLI](https://docs.convex.dev/cli) (`bunx convex`)
- Git

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/holophyte/holophyte.git
cd holophyte

# Install dependencies
bun install
```

### Setup `.dev-ports`

Create a `.dev-ports` file in the repo root (gitignored, per-workspace):

```
DEV_PORT=8080
CONVEX_CLOUD_PORT=3210
CONVEX_SITE_PORT=3211
CONVEX_TEAM=ko-vial
CONVEX_PROJECT=holophyte
```

This is required for `bun run dev:local` and `bun run convex:local`. Worktrees get their own `.dev-ports` automatically via `bun run worktree:create`.

### Development

**Cloud Convex (recommended for production workflows):**

```bash
# Start app server + cloud Convex dev server (port 8080)
bun run dev:all
```

**Local Convex (recommended for parallel development):**

```bash
# Start app server + local Convex backend (reads .dev-ports)
bun run dev:local
```

The app will be available at `http://localhost:8080`.

### Available Commands

```bash
bun run dev              # Start server with HMR (port 8080)
bun run dev:all          # App server + cloud Convex dev (port 8080)
bun run dev:local        # App server + local Convex (reads .dev-ports)
bun run convex:dev       # Start cloud Convex dev server
bun run convex:local     # Start local Convex backend (reads .dev-ports)
bun run test             # Run unit tests (vitest)
bun run test:ui          # Vitest UI dashboard
bun run test:e2e         # Playwright E2E tests (requires convex:dev running)
bun run lint             # Biome check
bun run lint:fix         # Biome auto-fix
bun run check            # lint + typecheck + test (all-in-one)
bun run convex:deploy    # Deploy Convex to production
bun run worktree:create <name>  # Create worktree with isolated local Convex
bun run pr-comments      # Show review bot PR comments (--poll for polling)
bun run storybook        # Start Storybook dev server (port 6006)
bun run docs:dev         # Start Docusaurus docs server
```

## Project Structure

```
├── src/
│   ├── server.ts              # Bun.serve() with routes (auth, config, directory picker)
│   ├── claude/
│   │   └── manager.ts         # Claude Agent SDK session management (spawn/stop/approve)
│   └── frontend/
│       ├── index.tsx          # React entry, Convex client setup
│       ├── App.tsx            # Main layout: Sidebar | KanbanBoard + SessionPanel | TaskDetailPanel
│       ├── stores/app.ts      # Zustand store (UI state)
│       ├── hooks/             # Custom React hooks (useSession, etc.)
│       ├── components/        # UI components (Kanban*, Task*, Session*, Sidebar, etc.)
│       └── components/ui/     # Radix UI primitives
├── convex/
│   ├── schema.ts              # Data model (multi-tenant with orgs)
│   └── *.ts                   # Convex queries and mutations
├── scripts/                   # Shell scripts (worktree, dev, etc.)
└── .githooks/                 # Git hooks (pre-commit)
```

## Architecture

### Data Flow for SDK Sessions

1. Frontend calls Convex mutation `api.sessions.create` with `taskId` + `prompt` + `model`
2. Companion process spawns Claude Code via Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
3. SDK events are persisted to Convex `sessionEvents` table via `consumeIterator()` → `bufferEvent()` → Convex mutations
4. Frontend subscribes to session events via `useSession()` hook using Convex real-time queries
5. User approvals resolve via Convex mutation `api.pendingApprovals.resolve()` → companion reads and resumes SDK

### Database Schema

Convex provides real-time synchronization with multi-tenant tables scoped to organizations. Key tables include repos, tasks, sessions, session events, pending approvals, labels, subtasks, and more — see `convex/schema.ts` for the full schema.

## Development Principles

- **KISS** — Write simple, readable code over clever solutions
- **DRY** — Eliminate code duplication through shared utilities and components
- **Do what was asked; nothing more, nothing less** — Avoid over-engineering

## Code Style

Enforced by [Biome](https://biomejs.dev/) (no ESLint/Prettier). Run `bun run lint:fix` before committing.

- 2 spaces, single quotes, semicolons always
- Default exports for React components; named exports for everything else
- PascalCase component files (`TaskCard.tsx`), camelCase for non-component modules
- Props typed with `interface ComponentNameProps`
- Use `import type` for type-only imports (`verbatimModuleSyntax` is on)

## Testing

**Unit Tests (Vitest):**
```bash
bun run test           # Run all unit tests
bun run test:ui        # Interactive UI dashboard
bunx vitest run path   # Run specific test file
```

**E2E Tests (Playwright):**
```bash
bun run test:e2e       # Requires convex:dev running separately
```

## Git Workflow

- **Features/refactors:** Use worktrees (`bun run worktree:create <name>`) for parallel development on `feat/<name>` branches
- **Quick fixes:** Work directly on a branch from main — no worktree needed
- Pre-commit hooks run automatically: `convex codegen` → `lint` → `typecheck`

### Commit Guidelines

- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`
- Commit frequently with descriptive messages — incremental changes over large batches
- Stage specific files rather than `git add .`

## Configuration

Server configuration uses environment variables with sensible defaults:

- `PORT` (default: `8080`) — server port
- `CONVEX_URL` — Convex deployment URL (served to frontend via `/api/config`)
- `SHELL` (default: `/bin/zsh`) — login shell for environment resolution
- `CONVEX_DEPLOYMENT` — managed by `convex dev` in `.env.local`

## Contributing

1. Fork the repository
2. Create your feature branch: `git checkout -b feat/amazing-feature`
3. Commit your changes following commit guidelines
4. Push to the branch: `git push origin feat/amazing-feature`
5. Open a Pull Request

Pre-commit hooks will automatically run to ensure code quality.

## License

[MIT](LICENSE) — see LICENSE file for details

## Acknowledgments

- Built with [Bun](https://bun.sh/)
- Real-time database by [Convex](https://convex.dev/)
- Conversation UI by [assistant-ui](https://www.assistant-ui.com/)
- UI components by [Radix UI](https://www.radix-ui.com/)

---

**Developer Notes:** See [CLAUDE.md](CLAUDE.md) for detailed guidance on working with this codebase using Claude Code.
