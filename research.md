# T3 Code — Codex & Claude Integration Research

**Repo:** [pingdotgg/t3code](https://github.com/pingdotgg/t3code) (~7,700 stars, MIT)
**By:** Ping.gg (Theo / t3.gg). Install via `npx t3` or desktop app.
**What it is:** Desktop GUI for AI coding agents — supports OpenAI Codex and Claude Code.

## Tech Stack

- **Monorepo:** Turborepo + Bun (package manager)
- **Runtime:** Node.js (not Bun) + **Effect** library (v4 beta) for DI, error handling, streaming
- **Server** (`apps/server`): Node.js WebSocket server, SQLite persistence, event sourcing
- **Web** (`apps/web`): React + Vite, connects via WebSocket
- **Desktop** (`apps/desktop`): Electron shell spawning the server
- **Contracts** (`packages/contracts`): Shared Effect Schema definitions (43 runtime event types)
- **Linting:** oxlint + oxfmt
- **Testing:** Vitest v4

## How They Integrate Codex (Not Using `@openai/codex-sdk`)

T3 Code does **not** use the `@openai/codex-sdk` npm package. Instead, they spawn `codex app-server` as a child process and communicate via **JSON-RPC over stdio** (newline-delimited JSON). This is a different mode than `codex exec` — `app-server` is a persistent, stateful process that supports multi-turn threads, approval requests, and model switching.

### Session Startup (`codexAppServerManager.ts`)

1. Validate Codex CLI version via `spawnSync`
2. Spawn `codex app-server` with `stdio: ['pipe', 'pipe', 'pipe']`
3. Send JSON-RPC `initialize` request with client capabilities
4. Send `initialized` notification
5. Probe `model/list` and `account/read` for account info (plan type, spark eligibility)
6. Open a thread via `thread/start` or attempt `thread/resume` (fallback to fresh start on failure)
7. Store provider-assigned `threadId` as `resumeCursor`

### Sending Turns

- Build input array of `{type: "text", text}` and `{type: "image", url}` items
- Resolve model based on account type (downgrade if plan doesn't support)
- Optionally include `collaborationMode` with `mode: "default" | "plan"` and settings (model, reasoning_effort, developer_instructions)
- Send `turn/start` JSON-RPC request → receive turn ID
- Update session status to `"running"` with `activeTurnId`

### Permissions/Approvals — They DO Have Per-Tool Approval!

This is the big finding. By using `codex app-server` (JSON-RPC mode) instead of `codex exec` (non-interactive mode), T3 Code gets **per-tool-call approval** for Codex — something the `@openai/codex-sdk` TypeScript wrapper doesn't expose:

- Codex sends `item/requestApproval` server requests via JSON-RPC
- T3 Code stores a `PendingApproval` keyed by request ID
- Emits event to UI → user approves/denies in browser
- `respondToRequest` sends JSON-RPC response: `{ id: jsonRpcId, result: { decision } }`

This means the "review after" vs "approve during" difference we noted on the Notion page **only applies when using the `@openai/codex-sdk` wrapper** (`codex exec` mode). The `codex app-server` mode gives the same interactive approval flow as Claude's `canUseTool`.

### Event Handling

- Parse each stdout line as JSON
- Classify as server request, server notification, or response
- Map into canonical `ProviderRuntimeEvent` types (43 distinct event types)
- Events include: `content.delta`, `request.opened`, `task.started/progress/completed`, `hook.started/progress/completed`, etc.

### Model Selection

- Models normalized via `normalizeCodexModelSlug()`, resolved via `resolveCodexModelForAccount()` based on plan type
- Default Codex model: `gpt-5.4`
- Model aliases supported (user-friendly slugs → API model IDs)
- Effort levels: `xhigh | high | medium | low`

### Session Resume

- `resumeCursor` stores `{ threadId: providerThreadId }`
- On reconnect, `thread/resume` attempted with stored threadId
- Fallback to `thread/start` on recoverable error

## How They Integrate Claude

Direct `@anthropic-ai/claude-agent-sdk` usage — same as us:

### Session Startup

- Import `query` from SDK
- Build `ClaudeQueryOptions` with model, effort, permission mode, custom settings
- Fork an Effect fiber to consume SDK messages asynchronously

### `canUseTool` Callback — Three Cases

1. **`AskUserQuestion`**: Emit `"user-input.requested"` event, wait for user response via Effect `Deferred`, return answers
2. **`ExitPlanMode`**: Capture proposed plan, deny execution with message telling agent to wait for feedback
3. **Standard tools**: Based on runtime mode (`full-access` bypasses), create pending approval, emit `"request.opened"`, wait for decision

### Mid-Session Model Switching

- Calls `context.query.setModel(apiModelId)` on each turn if model changed
- Calls `context.query.setPermissionMode()` based on interaction mode
- Default Claude model: `claude-sonnet-4-6`

### Resume

- `resumeCursor` with `{ threadId, resume (UUID), resumeSessionAt, turnCount }`

## Provider Abstraction

Clean multi-provider abstraction using Effect's service/layer pattern:

### `ProviderAdapterShape<TError>` — Core Interface

```typescript
interface ProviderAdapterShape<TError> {
  startSession(): void;
  stopSession(): void;
  listSessions(): void;
  hasSession(): void;
  stopAll(): void;
  sendTurn(): void;
  interruptTurn(): void;
  respondToRequest(): void;        // approvals
  respondToUserInput(): void;      // structured questions
  readThread(): void;
  rollbackThread(): void;
  streamEvents(): void;            // canonical ProviderRuntimeEvent stream
  capabilities: {
    modelSwitch: "in-session" | "restart-session" | "unsupported";
  };
}
```

### Two Concrete Adapters

1. **`CodexAdapter`** — wraps `CodexAppServerManager`, maps JSON-RPC events → canonical events
2. **`ClaudeAdapter`** — wraps `@anthropic-ai/claude-agent-sdk` `query()`, maps SDK messages → canonical events

### Registry & Routing

- `ProviderAdapterRegistry` — maps `"codex"` / `"claudeAgent"` to adapter instances
- `ProviderService` — routes API calls to correct adapter based on thread-provider bindings, manages session recovery, publishes events through PubSub

The abstraction is fully provider-agnostic — orchestration, persistence, and frontend never see provider-specific types.

## Skills & Commands

### Composer Commands

- `/model` — switch model
- `/plan` — plan mode
- `/default` — default mode
- Path-based file/folder insertion

Detected via `detectComposerTrigger()` in the composer. Not sourced from either SDK's command discovery.

### Plan Mode

- `interactionMode: "plan"` — agent proposes plan instead of executing
- Plans displayed in `PlanSidebar` with step-by-step status
- **Codex**: Uses `collaborationMode: { mode: "plan" }` in `turn/start`
- **Claude**: Uses `ExitPlanMode` tool denial pattern in `canUseTool`

### No Skill Discovery

No evidence of using `supportedCommands()` from Claude SDK or parsing `.agents/skills/` for Codex. Commands are hardcoded in the UI.

## Multi-Agent / Subagent

Limited — no explicit multi-agent UI:

- Codex `collaborationMode` tracked via `collabReceiverTurns` map
- Runtime events include `task.started/progress/completed`, `hook.started/progress/completed`
- These correspond to Codex's internal task decomposition
- No Claude subagent observation (`supportedAgents()`, etc.)
- No multi-session coordination between threads

## Architecture

```
Browser (React + Vite)
  ↕ WebSocket (JSON-RPC style)
Server (Node.js + Effect + SQLite)
  ├── OrchestrationEngine (event sourcing: commands → events → projections)
  ├── ProviderService (routes to adapters)
  ├── CodexAdapter → CodexAppServerManager → codex app-server (subprocess, JSON-RPC/stdio)
  ├── ClaudeAdapter → @anthropic-ai/claude-agent-sdk query() sessions
  ├── Persistence (SQLite: events, projections, sessions, checkpoints)
  ├── GitManager (worktrees, branches, PRs)
  └── Terminal (node-pty)
Desktop (Electron shell, spawns server)
```

## Key Takeaways for Holophyte

### 1. Use `codex app-server`, Not `@openai/codex-sdk`

This is the biggest finding. The `@openai/codex-sdk` is a thin wrapper around `codex exec` — non-interactive, no per-tool approval, no model switching, no skill access. But `codex app-server` is a persistent JSON-RPC server that gives you:
- Per-tool-call approval (same as Claude's `canUseTool`)
- Thread management (start, resume, read, rollback)
- Model listing and account info
- Collaboration/plan mode
- Full event stream with content deltas, task tracking, hooks

This eliminates the "review after vs approve during" gap between Claude and Codex.

### 2. Provider Abstraction IS Viable — With Shared Event Schema

T3 Code proves the approach works: 43 canonical event types that both providers map into. The abstraction lives at the event/lifecycle level, not at the SDK API level. Provider-specific capabilities (Claude's `setModel()` vs Codex's JSON-RPC `thread/start` with model) are handled inside adapters.

### 3. Shared Approval Flow

Both providers can have per-tool-call approval when Codex uses `app-server` mode. T3 Code uses the same pending approval → user decision → resolve flow for both. This means Holophyte's existing `pendingApprovals` table and polling mechanism could work for Codex too.

### 4. Plan Mode as a Cross-Provider Feature

Both providers support plan mode, implemented differently:
- Codex: native `collaborationMode` in JSON-RPC
- Claude: `ExitPlanMode` tool denial hack in `canUseTool`

### 5. What T3 Code Doesn't Do (Opportunities)

- No skill discovery or custom command support from either SDK
- No multi-agent observation or subagent UI
- No MCP management through the UI
- Uses local SQLite, not a real-time database — no multi-device sync
- Desktop-only (Electron) — no cloud/hosted option

### 6. Architecture Differences

| | T3 Code | Holophyte |
|--|--|--|
| Persistence | Local SQLite | Convex (real-time, cloud) |
| Reactivity | WebSocket push | Convex real-time queries |
| Codex integration | `codex app-server` (JSON-RPC/stdio) | TBD — should use app-server too |
| Claude integration | `@anthropic-ai/claude-agent-sdk` | Same |
| State management | Event sourcing (commands → events → projections) | Direct Convex mutations |
| Desktop | Electron | Browser-based with local companion |
| DI/Error handling | Effect library | Plain TypeScript |

---

# Codex SDK & App-Server Ecosystem

## `@openai/codex-sdk` vs `codex app-server` — Two Different Protocols

These are fundamentally different integration paths:

| | `@openai/codex-sdk` (npm) | `codex app-server` (JSON-RPC) |
|--|--|--|
| Protocol | One-shot JSONL via `codex exec` | Bidirectional JSON-RPC 2.0 |
| Transport | Spawn process per turn, pipe stdin/stdout | Persistent subprocess, stdio or websocket |
| Approvals | No per-tool callback, policy only | Full per-tool approval requests |
| Model switching | Not supported mid-session | Supported via protocol |
| Thread management | Basic (start, resume) | Full (start, resume, fork, read, rollback) |
| Skills | Not accessible (exec mode) | Available (app-server runs interactive mode) |
| Powers | Simple scripts, one-off tasks | VS Code extension, T3 Code, rich UIs |

**Bottom line:** `codex app-server` is the real programmatic interface. The npm SDK is a convenience wrapper for simple use cases.

## `codex app-server` — Not an Internal API

Initially assumed to be undocumented/internal, but it's actually well-supported:

- Full README at `codex-rs/app-server/README.md` with protocol documentation
- Dedicated Rust crates: `app-server`, `app-server-client`, `app-server-protocol`, `app-server-test-client`
- **Powers the VS Code extension** — this is the official rich integration path
- Schema generation: `codex app-server generate-ts` / `codex app-server generate-json-schema`
- Supports stdio and websocket transports
- Very active development — daily commits

## Codex SDK Release Cadence

- **Fully open source**: Apache-2.0, https://github.com/openai/codex
- **68,000+ stars**, 100+ contributors, 2,100+ open issues
- **487 npm releases** for `@openai/codex-sdk`, **1,606** for `@openai/codex` (CLI)
- Multiple alpha releases **per day**, stable releases roughly weekly
- v0.43 → v0.117 in ~6 months
- Core is **Rust** (~70 internal crates), TS SDK is a thin wrapper at `sdk/typescript/src/`

## Client Library Options

### Option 1: `codex-app-server-client` (Recommended)

- **npm:** [codex-app-server-client](https://www.npmjs.com/package/codex-app-server-client) (v0.1.4, 308 downloads/week)
- **Repo:** [BrandonMJohnson/codex-client](https://github.com/BrandonMJohnson/codex-client)
- Zero runtime dependencies
- Full typed client: `StdioTransport` → `RpcSession` → `AppServerClient`
- **70+ generated TypeScript types** for both stable and experimental protocol surfaces
- Ships JSON schemas for every protocol message
- Tests, CI, VitePress docs, changelog
- `engines: ">=24.0.0"` (Node 24) — Bun should be fine
- **Escape hatch:** If abandoned, fork it or regenerate types via `codex app-server generate-ts` and build our own thin client

### Option 2: Build Our Own (~400 lines + generated types)

1. `codex app-server generate-ts --out ./generated` → 70+ type files
2. Stdio transport (~50 lines)
3. JSON-RPC session with request/response correlation (~150 lines)
4. App-server client with thread/turn/approval methods (~200 lines)
5. Could use `vscode-jsonrpc` (9M downloads/week, zero deps) as transport layer

### Option 3: `@openai/codex-sdk` — Not Recommended

- Uses `codex exec` (non-interactive), missing per-tool approval, model switching, skills
- Would require starting over if we later need app-server features

### Option 4: Fork `@openai/codex-sdk` — Not Viable

- SDK uses completely different protocol (JSONL) from app-server (JSON-RPC)
- Would be a full rewrite, not a fork

### Other Packages Found

- `salambo-codex-agent-sdk` (v1.1.0, 16 downloads/week) — too small/unknown
- `codex-app-server` (v0.1.5, 7 downloads/week) — WebSocket bridge, different use case

## Recommended Integration Architecture for Holophyte

```
Frontend (Browser)
  ↕ Convex real-time queries
Convex (Cloud Database)
  ↕ HTTP/subscriptions
Companion (Local, Bun)
  ├── ClaudeSessionManager
  │   └── @anthropic-ai/claude-agent-sdk → query() iterator
  ├── CodexSessionManager (NEW)
  │   └── codex-app-server-client → codex app-server (JSON-RPC/stdio)
  └── Both managers → normalize events → Convex sessionEvents mutations
```

**Key design decisions:**
1. **Use `codex app-server`** via `codex-app-server-client` package — gets us per-tool approval, model switching, full event stream
2. **`provider` field on sessions table** — `'claude' | 'codex'`
3. **Shared Convex schema** — both providers write to `sessionEvents` and `pendingApprovals` with normalized event format
4. **Provider-specific session managers** — `ClaudeSessionManager` (existing `manager.ts`) and `CodexSessionManager` (new), each handling their SDK's quirks
5. **No premature abstraction** — build both managers, see the real seams, then extract a shared interface if it emerges naturally
6. **Approval flow reuse** — `codex app-server` supports per-tool approval, so the existing `pendingApprovals` table + companion polling + frontend approve/deny buttons work for both providers
