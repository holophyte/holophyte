# Phase 1: Backend Migration

Replace the PTY-based session manager with the Claude Agent SDK. This is the foundational change — everything in Phases 2-4 builds on the event model established here.

## What Changes

The current `src/claude/manager.ts` spawns Claude Code as a raw PTY process via `Bun.spawn()` with the `terminal` option. Output is an opaque stream of bytes (ANSI escape sequences, text, control characters) piped over WebSocket to xterm.js. Input goes the other direction — keystrokes from the browser into `proc.terminal.write()`.

The SDK replaces all of this with a single `query()` call that returns an async iterable of typed events. Instead of bytes, you get structured messages: Claude's responses, tool call requests, permission prompts, results with cost data. The PTY, ANSI parsing, and terminal resize logic all go away.

## The Session Manager

`manager.ts` currently maintains an in-memory `Map<string, Session>` where each `Session` holds a PTY process handle, a set of WebSocket subscribers, and metadata. The new manager keeps the same shape but swaps internals:

```
Before:  Session = { proc (Bun PTY), subscribers (Set<WebSocket>), ... }
After:   Session = { iterator (SDK AsyncGenerator), controller (AbortController),
                     subscribers (Set<WebSocket>), approvalQueue (Map), ... }
```

The `approvalQueue` is the key new concept. When the SDK's `canUseTool` callback fires, it creates a promise and parks it in the queue keyed by a request ID. The promise resolves when the frontend sends an approve/reject response via a new API endpoint. This is how permission prompts become UI buttons instead of terminal y/n prompts.

### Session Lifecycle

The session state machine stays the same (running → completed/failed/stopped) but gains a new intermediate state: **waiting_input**. This isn't a DB status — it's a transient state derived from whether there's an unresolved entry in the approval queue. The frontend uses this to show attention indicators.

Starting a session:
1. Create session record in Convex (status: running)
2. Build SDK options: `cwd`, `model`, `allowedTools`, `canUseTool` callback, `AbortController`
3. Call `query()` — returns immediately with an async iterator
4. Start consuming the iterator in a background loop
5. For each event: broadcast to WebSocket subscribers + buffer for Convex persistence

Stopping a session:
1. Call `controller.abort()` on the AbortController
2. The SDK handles cleanup (sends SIGTERM to Claude Code subprocess)
3. The iterator completes, the consumption loop exits
4. Update session status in Convex
5. Notify subscribers of session end

### The canUseTool Callback

This is the most architecturally important piece. The callback receives a tool name and input, and must return a decision (allow/deny). But the decision comes from a human clicking a button in the browser, which means the callback needs to park itself and wait:

```
canUseTool fires → create pending approval → broadcast to WS subscribers →
  ...user sees prompt in browser, clicks Approve... →
  POST /api/sessions/:id/respond → resolve pending approval → callback returns
```

The approval queue is a `Map<requestId, { resolve, toolName, input }>`. Each pending approval gets a unique ID so the frontend can reference it when responding. If the session is aborted while an approval is pending, the promise rejects and the callback returns `deny`.

For auto-approved tools (Read, Glob, Grep in "Safe Auto" mode), the callback returns immediately without creating a pending approval. The permission profile determines which tools get auto-approved.

## WebSocket Protocol

The current WebSocket sends raw `Uint8Array` chunks (PTY output bytes). The new protocol sends JSON messages. Every message has a `type` field:

```typescript
// Server → Client
{ type: 'event', sessionId, event: SDKMessage }           // SDK event (assistant, result, etc.)
{ type: 'permission', sessionId, requestId, tool, input }  // needs user decision
{ type: 'status', sessionId, status }                       // session lifecycle change
{ type: 'error', sessionId, message }                       // error

// Client → Server (these could also be REST, but WS is lower latency)
{ type: 'approve', sessionId, requestId }
{ type: 'deny', sessionId, requestId, message? }
{ type: 'message', sessionId, text }                        // follow-up message to Claude
```

The WebSocket connection is still per-session (connected via `/ws/session/:sessionId`), same as today. Multiple browser tabs can subscribe to the same session.

## API Routes

The existing routes change shape:

- `POST /api/sessions/start` — mostly the same, but accepts `model` and `permissionProfile` in addition to `taskId`, `repoPath`, `prompt`
- `POST /api/sessions/:id/stop` — calls `controller.abort()` instead of `proc.kill()`
- `POST /api/sessions/:id/resize` — **removed** (no terminal to resize)
- `POST /api/sessions/:id/respond` — **new**: approve/reject a pending permission, or send a follow-up message

## Convex: sessionEvents Table

Every SDK event gets persisted to Convex for session history and replay. But writing every event individually would be expensive — PTY-equivalent throughput could be dozens of events per second during active generation.

The approach: buffer events in memory per session, flush to Convex every ~5 seconds. The buffer is an array of serialized events. On flush, a single mutation appends the batch to the session's event log.

Schema sketch:
```
sessionEvents: {
  sessionId: v.id('sessions'),
  events: v.array(v.object({
    type: v.string(),
    data: v.any(),
    timestamp: v.number(),
  })),
  batchIndex: v.number(),  // ordering across batches
}
```

Indexed by `sessionId` + `batchIndex` for ordered retrieval. Querying a full session's history means fetching all batches for that sessionId, sorted by batchIndex, and flattening the events arrays.

On session end, flush any remaining buffer immediately (don't wait for the 5s interval).

## What Gets Removed

- `Bun.spawn()` with `terminal` option — replaced by SDK `query()`
- `proc.terminal.write()` / `proc.terminal.resize()` — no PTY
- ANSI byte streaming over WebSocket — replaced by JSON events
- The `/api/sessions/:id/resize` endpoint
- Any PTY-specific error handling (process signals, exit codes) — SDK handles this internally

## What Gets Kept

- The in-memory `Map<string, Session>` pattern — still the right approach for active sessions
- WebSocket subscriber sets — same fan-out pattern, different payload format
- Session CRUD in Convex (create on start, update status on end)
- The general request flow: frontend → REST API → manager → Convex

## Dependencies

```
Add:    @anthropic-ai/claude-agent-sdk
Remove: (nothing yet — xterm.js removal happens in Phase 2)
```

## Phase 0 Findings

These were confirmed during the SDK proof of concept:

- **`deny` requires `message`**: returning `{ behavior: 'deny' }` from `canUseTool` throws — must be `{ behavior: 'deny', message: '...' }`. The approval queue must always include a message when rejecting.
- **`setModel()` is immediate**: takes effect within the current session, not just the next one. Mid-session model switching works.
- **Bash is used for file creation**: Claude prefers `Bash` over `Write` for creating files (`cat > file` patterns). The Safe Auto permission profile cannot simply auto-approve all Bash commands — doing so would silently allow file writes. Safe Auto needs a more nuanced approach: auto-approve Bash commands that match known safe patterns (test runs, lint, build commands) and prompt for arbitrary Bash.
- **Session resume**: capture `session_id` from the `system/init` event and persist it on the session record in Convex. Pass as `options.resume` in subsequent `query()` calls.

## Key Risks

- **Safe Auto Bash handling**: since Claude uses Bash for file creation, defining what "safe" Bash looks like requires care. A pattern allowlist (e.g. `bun run *`, `bunx *`, `git status`, `git diff`) is more reliable than trying to detect intent from arbitrary commands.
- **canUseTool latency**: if a user takes a long time to approve, the SDK session parks indefinitely. No observed timeout during Phase 0, but worth monitoring under real usage.
- **Memory**: each session holds an event buffer that grows until flushed. For long sessions with heavy output, this could get large. Consider capping buffer size and force-flushing when it exceeds a threshold.
- **Session resume across server restarts**: SDK's `resume` option needs a session_id from a previous run. If the server crashes, we lose in-memory state but the session_id is in Convex. On restart, we could attempt to resume orphaned sessions — but the Claude Code subprocess is gone, so resume would start a new subprocess with conversation history loaded.

## Done When

- `manager.ts` uses SDK `query()` instead of `Bun.spawn()` with PTY
- Sessions can be started, stopped, and resumed via the API
- Permission prompts flow through `canUseTool` → approval queue → REST/WS response
- Events stream over WebSocket as JSON
- Events persist to Convex in batches
- No PTY code remains in the backend
