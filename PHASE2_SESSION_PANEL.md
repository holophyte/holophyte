# Phase 2: Session Panel

Replace the xterm.js terminal with a purpose-built React UI for viewing and interacting with Claude Code sessions. This is where the SDK migration becomes visible to the user.

## Why Not a Terminal

The terminal was the right first step — it's the fastest way to get Claude Code output into a browser. But it's the wrong long-term surface for a project management tool. A terminal is optimized for sequential interaction with one process. Holophyte needs to manage many sessions across many tasks, with at-a-glance status, structured history, and UI-native interactions (buttons, not keystrokes).

The SDK gives us structured data. The session panel renders that data as a conversation — messages, tool calls, permission prompts, results — instead of a wall of ANSI text.

## Phase 1 Findings

These details were discovered during Phase 1 implementation and affect Phase 2:

- **WebSocket path changed to `/ws/session/:sessionId`** (was `/ws/terminal/:sessionId`)
- **WS protocol uses typed JSON messages** with four types: `event` (SDK events), `permission` (approval requests), `status` (lifecycle changes), `error` (error messages). Defined as `WsServerMessage` in `src/claude/manager.ts`.
- **All models have startup latency**, not just Haiku. The loading indicator should be unconditional.
- **Backend session statuses are `'running' | 'completed' | 'failed' | 'stopped'`** — `waiting_input` is a frontend-derived state (from pending `permission` WS messages), not a backend status.
- **Follow-up message injection doesn't exist yet.** Phase 1's `POST /api/sessions/:id/respond` only handles approve/deny for permission prompts. Injecting user messages into the SDK conversation needs new backend work (either extending the respond endpoint or adding a separate message endpoint).
- **Pending approvals must be replayed on WS connect.** When `canUseTool` fires and no client is subscribed yet (or a client reconnects), the `permission` broadcast is missed and the session hangs indefinitely waiting for a response. The `server.ts` `websocket.open` handler must replay all entries in `session.approvalQueue` to the newly connected client.

## Component Architecture

The `TerminalPanel` component gets replaced by `SessionPanel`. It occupies the same position in the layout (bottom or right pane, resizable) but renders completely different content.

### SessionPanel

The outer container. Manages which session is active, handles the WebSocket connection, and dispatches events to child components.

State it manages:
- `events: AgentEvent[]` — the accumulated event stream for the current session
- `pendingApprovals: Map<requestId, { tool, input }>` — permission prompts awaiting user action
- `sessionStatus: 'running' | 'waiting_input' | 'completed' | 'failed'` — derived from events + approval queue
- `isConnected: boolean` — WebSocket health

The WebSocket connection receives JSON events from the server and appends them to the events array. When a `permission` message arrives, it adds to pendingApprovals. When the user approves/denies, it sends the response back over the WebSocket (or via REST).

### MessageStream

The main content area — a scrolling list of Claude's messages rendered as markdown. Each `assistant` event becomes a message bubble. Streaming events (`stream_event`) update the latest message in place as tokens arrive, giving the real-time typing effect.

This should feel like a chat interface but read-only on Claude's side — the user can't edit Claude's messages, but they can see them build up in real time.

Long messages should be readable — proper markdown rendering with syntax-highlighted code blocks, inline code, lists, bold/italic. Something like `react-markdown` with `rehype-highlight` or similar.

Auto-scroll to bottom as new content arrives, but stop auto-scrolling if the user scrolls up (they're reading something above). Resume auto-scroll when they scroll back to bottom.

**Startup loading state**: All models have noticeable latency before the first streaming event arrives (not just Haiku — confirmed in Phase 1). The panel should show a loading indicator ("Starting session…" with a spinner or subtle pulse) from the moment the session is launched until the first event is received. Without this, the panel looks broken during that quiet window.

### ToolCallCard

When Claude uses a tool (Read, Edit, Bash, Grep, etc.), it shows as a collapsible card inline in the message stream. Collapsed by default (to avoid noise), expandable to see details.

The card shows:
- Tool name + icon (file icon for Read/Edit, terminal icon for Bash, search icon for Grep)
- One-line summary: "Read src/server.ts", "Edit src/claude/manager.ts (lines 42-58)", "Bash: bun run test"
- Expanded: full input parameters, and if available, the result (file contents, command output, etc.)

For `Edit` tool calls specifically, showing a diff view (old → new) would be very useful — this is what you'd normally see in the terminal as Claude's edit output. A simple side-by-side or inline diff with syntax highlighting.

Tool results that are very long (like reading a large file) should be truncated with a "Show more" toggle.

### PermissionPrompt

When the `canUseTool` callback on the backend creates a pending approval, the frontend receives a `permission` WebSocket message. This renders as a prominent card at the bottom of the message stream (or pinned above the input area) with:

- What Claude wants to do: tool name + a human-readable description
- The input: what file, what command, what edit — with enough context to make an informed decision
- **Approve** and **Reject** buttons
- Optional: a text field for rejection reason (so Claude gets useful feedback)

For `Bash` commands, show the exact command that will run — this is the most security-sensitive approval. For `Edit`, show the file path and the proposed change. For `Write`, show the file path and a preview of contents.

Multiple pending approvals can stack (if Claude tries to use multiple tools rapidly). They should be visually distinct — maybe numbered or with the tool name as a header.

Once approved/rejected, the card transitions to a resolved state (shows "Approved" or "Rejected" with a muted style) and stays in the message stream for context.

### UserInput

A text input area at the bottom of the panel for sending follow-up messages to Claude mid-session. This is the equivalent of typing a response when Claude asks a question in the terminal.

- Text area (not single-line input) — sometimes you need to write multi-line instructions
- Send button + Cmd+Enter to submit
- Disabled when no session is active or session is completed
- Placeholder text: "Send a message to Claude..." when session is running, "Session completed" when done

Sending a message dispatches it to the backend via `POST /api/sessions/:id/respond` with type `message`. The backend injects it into the SDK conversation (implementation detail of Phase 1).

### ModelPicker

A dropdown or segmented control for selecting which Claude model to use. Shown in two places:

1. **In the session launch UI** (before starting) — the primary selection point. Options: Opus 4.6, Sonnet 4.5, Haiku 4.5 with a brief note on the tradeoff (capability vs speed vs cost).
2. **In the session panel header** (while running) — shows current model, potentially allows switching mid-session via `setModel()`. This is lower priority — model switching mid-session is an edge case.

The default model should be configurable per-repo (stored in Convex on the repo record) and overridable per-task at launch time.

## What Gets Removed

- `xterm` and `@xterm/addon-fit` npm dependencies
- `useTerminal` hook (the xterm.js + WebSocket integration)
- `TerminalPanel` component
- Any terminal-specific CSS (the `.xterm` container styles)

## Visual Design Considerations

The session panel needs to feel native to the existing Holophyte UI — same dark theme, same Tailwind classes, same Radix UI primitives. It should not look like a bolted-on chat widget.

The message stream should have enough contrast between Claude's messages and tool call cards to scan quickly. Color coding helps: message text in the default foreground, tool cards with a subtle background tint, permission prompts with an amber/yellow accent, errors in red.

The panel should be comfortable to read at the sizes it will actually be used — typically half the viewport width or a bottom third. Long code blocks should horizontal-scroll rather than wrapping.

## Data Flow

```
WebSocket event arrives
  → SessionPanel receives JSON
  → if type='event': append to events[], MessageStream re-renders
  → if type='permission': add to pendingApprovals, PermissionPrompt appears
  → if type='status': update sessionStatus

User clicks Approve
  → PermissionPrompt sends { type: 'approve', requestId } via WS
  → Move approval from pending to resolved in local state
  → Card transitions to "Approved" style

User types follow-up message
  → UserInput sends POST /api/sessions/:id/respond { type: 'message', text }
  → Message appears in stream as a "user" bubble
  → Claude processes it, new events flow back
```

## Done When

- Session panel renders SDK events as a conversation UI
- Claude's messages display as formatted markdown with syntax highlighting
- Tool calls show as collapsible cards with relevant details
- Permission prompts show as actionable cards with Approve/Reject buttons
- Follow-up messages can be sent mid-session
- Model picker works at launch time
- xterm.js and related dependencies are removed
- The panel is visually consistent with the rest of the app
