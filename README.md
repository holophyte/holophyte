# Holophyte

**Project management app for running parallel Claude Code sessions.**

Holophyte is a kanban board application that lets you create tasks with prompts, launch Claude Code in PTY terminals per task, and stream terminal output to your browser via WebSocket in real-time.

## Features

- **Kanban Board UI** — Organize tasks across customizable workflow states
- **Terminal Per Task** — Each task spawns its own Claude Code PTY session
- **Real-time Streaming** — WebSocket-powered terminal I/O in the browser using xterm.js
- **Real-time Database** — Convex provides instant synchronization across all clients
- **Parallel Development** — Git worktrees for isolated feature branches with per-workspace local Convex backends

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/) — Fast JavaScript runtime with native TypeScript support
- **Frontend:** [React 19](https://react.dev/) + [Zustand](https://zustand.docs.pmnd.rs/) (state management)
- **Backend:** Bun.serve() with routes + WebSocket handler
- **Database:** [Convex](https://convex.dev/) — Real-time database with automatic synchronization
- **Terminal:** Bun native PTY ([`Bun.spawn`](https://bun.sh/docs/api/spawn#spawn-a-process)) + [xterm.js](https://xtermjs.org/)
- **Styling:** [Tailwind CSS v4](https://tailwindcss.com/) (CSS-first config)
- **UI Components:** [Radix UI](https://www.radix-ui.com/)
- **Icons:** [Lucide React](https://lucide.dev/)

## Prerequisites

- [Bun](https://bun.sh/) v1.3.5+ (for native PTY support)
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
bun run pr-comments      # Show Greptile PR comments (--poll for polling)
bun run storybook        # Start Storybook dev server (port 6006)
bun run docs:dev         # Start Docusaurus docs server
```

## Project Structure

```
├── src/
│   ├── server.ts              # Bun.serve() with routes + WebSocket handler
│   ├── claude/
│   │   └── manager.ts         # PTY process management (spawn/stop/resize)
│   └── frontend/
│       ├── index.tsx          # React entry, Convex client setup
│       ├── App.tsx            # Main layout: Sidebar | Board | Terminal
│       ├── stores/app.ts      # Zustand store (UI state)
│       ├── hooks/             # Custom React hooks (useTerminal, etc.)
│       ├── components/        # UI components (Kanban, Task, Terminal, etc.)
│       └── components/ui/     # Radix UI primitives
├── convex/
│   ├── schema.ts              # Data model: repos, tasks, sessions
│   └── *.ts                   # Convex queries and mutations
├── scripts/                   # Shell scripts (worktree, dev, etc.)
└── .githooks/                 # Git hooks (pre-commit)
```

## Architecture

### Data Flow for Terminal Sessions

1. Frontend POSTs to `/api/sessions/start` with `taskId` + `prompt`
2. Server spawns Claude Code via Bun native PTY (`Bun.spawn` with `terminal` option)
3. Frontend opens WebSocket to `/ws/terminal/:sessionId`
4. PTY output → `data` callback → WebSocket → xterm.js in browser
5. User terminal input → WebSocket → `proc.terminal.write()` → PTY

### Database Schema

Convex provides real-time synchronization with three main tables:

- **repos** — Git repositories
- **tasks** — Kanban tasks (with status, prompt, assigned repo)
- **sessions** — Active Claude Code terminal sessions per task

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
- `SHELL` (default: `/bin/zsh`) — login shell for PTY env resolution
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
- Terminal emulation by [xterm.js](https://xtermjs.org/)
- UI components by [Radix UI](https://www.radix-ui.com/)

---

**Developer Notes:** See [CLAUDE.md](CLAUDE.md) for detailed guidance on working with this codebase using Claude Code.
