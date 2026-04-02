---
sidebar_position: 5
title: MCP Server
---

# MCP Server

Holophyte includes an MCP (Model Context Protocol) server that exposes project management capabilities to any MCP client. This lets you manage tasks, check session status, and launch sessions from Claude Code or other AI tools without touching the browser.

## Quick Start

### 1. Register in Claude Code

Add to `~/.claude.json` under `mcpServers`:

```json
{
  "mcpServers": {
    "holophyte": {
      "command": "bun",
      "args": ["run", "src/mcp/server.ts"],
      "cwd": "/path/to/holophyte"
    }
  }
}
```

### 2. Verify it works

Restart Claude Code. The 10 Holophyte tools should appear in your tool list. Try:

> Use holophyte_list_repos to show my repos

## How It Works

The MCP server runs as a **stdio subprocess** spawned by the MCP client. It:

1. Authenticates with Convex using the API key from `~/.holophyte/api-key`
2. Resolves your default organization (prefers personal org)
3. Exposes 10 tools that map directly to existing Convex queries/mutations
4. Returns structured JSON responses

**No HTTP server** is needed — communication happens over stdin/stdout via JSON-RPC.

## Authentication

The MCP server requires an API key. There is no fallback to anonymous auth or stored OAuth tokens.

```
~/.holophyte/api-key
        |
        v
  auth:signIn (api-key Convex Auth provider)
        |
        v
      JWT
        |
        v
  ConvexHttpClient
```

On startup the server reads `~/.holophyte/api-key`, calls Convex's `auth:signIn` action using the `api-key` provider, and receives a JWT for the key's owner. That JWT is used for all subsequent Convex queries and mutations via `ConvexHttpClient`.

To prevent expiry during long sessions, the JWT is refreshed every 30 minutes via a background interval.

If the key file is missing or the key is invalid (revoked, malformed), the server exits immediately with a clear error message rather than falling back to a different identity.

To generate an API key, see the [API Keys](api-keys) page.

## Tools Reference

### Read-only tools

| Tool | Description |
|------|-------------|
| `holophyte_list_repos` | List repos for an organization |
| `holophyte_list_tasks` | List tasks with filters (repo, status, archived) |
| `holophyte_get_task` | Get full task details (prompt, subtasks, labels, session) |
| `holophyte_get_session` | Get session status, model, timing |
| `holophyte_list_templates` | Browse prompt templates |
| `holophyte_board_summary` | Board stats (task counts by status, running sessions) |

### Write tools

| Tool | Description |
|------|-------------|
| `holophyte_create_task` | Create a task with title, prompt, status |
| `holophyte_update_task` | Update task fields or move to a new status |
| `holophyte_launch_session` | Start a session for a task (queued for companion pickup) |
| `holophyte_stop_session` | Request stop for a running session |

### Common parameters

- **`orgId`** — Optional on most tools. Defaults to your personal org. Only needed if you belong to multiple organizations.
- **`repoId`** — Scopes queries to a specific repo. Without it, tools query across all repos in the org.

### Examples

```
# List all in-progress tasks
holophyte_list_tasks { "status": "in_progress" }

# Create a task and launch a session
holophyte_create_task { "repoId": "...", "title": "Fix login bug", "prompt": "Fix the login timeout issue in auth.ts", "status": "in_progress" }
holophyte_launch_session { "taskId": "..." }

# Check if a session is done
holophyte_get_session { "id": "..." }

# Get board overview
holophyte_board_summary {}
```

## Requirements

- **API key** — An API key must be stored at `~/.holophyte/api-key`. Generate one from **Settings > API Keys** in the web UI and save it with `bun run setup:companion apikey`. The server will not start without a valid key.
- **Convex backend running** — The MCP server needs a running Convex deployment. `CONVEX_URL` must be set in `.env.local`.
- **Companion process for sessions** — `holophyte_launch_session` creates a queued session. A running companion (`bun run companion` or `bun run dev:local`) is needed to actually start the SDK process. The tool warns if the companion appears offline.

## Architecture

```
MCP Client (Claude Code)
    ↕ stdio (JSON-RPC)
src/mcp/server.ts
    ↕ HTTP (one-shot queries/mutations)
Convex Backend
    ↕ (companion polls for queued sessions)
Companion Process → Claude Agent SDK
```

The MCP server uses `ConvexHttpClient` exclusively (no WebSocket subscriptions). Each tool call is a one-shot query or mutation — no persistent connections between calls.

## Troubleshooting

**"CONVEX_URL not set"** — Ensure `bun run convex:local` or `bun run convex:dev` has been run to create `.env.local`.

**Auth failures** — The MCP server requires a valid API key at `~/.holophyte/api-key`. If the file is missing, generate a key from **Settings > API Keys** in the web UI and save it with `bun run setup:companion apikey`. If the key exists but is rejected, it may have been revoked — generate a new one.

**Session stays queued** — The companion process isn't running. Start it with `bun run dev:local` or `bun run companion`.

**Tools not appearing** — Check `~/.claude.json` for correct `cwd` path. The server needs to run from the Holophyte repo root so path aliases resolve.
