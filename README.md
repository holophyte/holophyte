# Holophyte

Project management app for running parallel Claude Code sessions. A kanban board UI lets you create tasks with prompts, launch Claude Code sessions via the [Agent SDK](https://github.com/anthropics/claude-agent-sdk), and stream results back to the browser in real-time.

## Why?

Claude Code is powerful but single-threaded — you can only run one session at a time. Holophyte removes that bottleneck. Create a board of tasks, give each one a prompt, and launch them all in parallel. A companion process manages the SDK sessions while Convex keeps everything in sync across clients.

## How It Works

The frontend is a React SPA that talks exclusively to [Convex](https://convex.dev/) (real-time database). A **companion process** subscribes to Convex for work — when you queue a task, it picks it up, spawns a Claude Code session via the Agent SDK, and streams events back through Convex. Approvals, follow-up messages, and session lifecycle all flow through Convex mutations — no direct connection between browser and companion.

## Tech Stack

[Bun](https://bun.sh/) &middot; [React 19](https://react.dev/) &middot; [Convex](https://convex.dev/) &middot; [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) &middot; [TanStack Router](https://tanstack.com/router) &middot; [assistant-ui](https://www.assistant-ui.com/) &middot; [Tailwind CSS v4](https://tailwindcss.com/) &middot; [Radix UI](https://www.radix-ui.com/) &middot; [Biome](https://biomejs.dev/)

## Getting Started

Setup instructions coming soon — some infrastructure is still in flux. In the meantime, see [CLAUDE.md](CLAUDE.md) for development guidelines and architecture details.

## Documentation

Run `bun run docs:dev` for the full Docusaurus documentation site covering architecture, sessions, testing, and local development. See [CLAUDE.md](CLAUDE.md) for development guidelines.

## License

[MIT](LICENSE)
