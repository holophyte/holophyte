# AI Agent Orchestration Research

Research into how other tools implement Claude Code / AI coding agents in their apps, and ideas for making Holophyte stand out.

> **Last updated:** 2026-02-11

---

## Table of Contents

1. [Competitor Landscape](#1-competitor-landscape)
2. [Claude Agent SDK — The Big Opportunity](#2-claude-agent-sdk--the-big-opportunity)
3. [Isolation Strategies](#3-isolation-strategies)
4. [Terminal Streaming & WebSocket Patterns](#4-terminal-streaming--websocket-patterns)
5. [Agent Lifecycle Management](#5-agent-lifecycle-management)
6. [Task Queuing & Scheduling](#6-task-queuing--scheduling)
7. [Session Persistence & Checkpointing](#7-session-persistence--checkpointing)
8. [Cost Tracking & Observability](#8-cost-tracking--observability)
9. [Security & Sandboxing](#9-security--sandboxing)
10. [Ideas to Make Holophyte Stand Out](#10-ideas-to-make-holophyte-stand-out)

---

## 1. Competitor Landscape

### 1.1 Conductor (Desktop — macOS)

- **Website:** https://www.conductor.build
- **Docs:** https://docs.conductor.build
- **YC Launch:** https://www.ycombinator.com/launches/OHk-conductor-run-a-bunch-of-claude-codes-in-parallel
- **Type:** Closed-source macOS desktop app (Apple Silicon required)
- **Founded by:** Jackson de Campos (ex-Netflix ML infra) + Charlie Holtz

**How it works:**
- Each Claude Code instance runs in a separate git worktree
- Uses your existing Claude Code auth (API key, Claude Pro, or Claude Max)
- Diff-first review model — you review diffs, not entire files
- "Setup scripts" field per repo runs on every new workspace creation (handles `.env`, `npm install`, etc.)
- Checkpointing: one-click reset of files, git, and chat to a prior state
- MCP server integration for connecting agents to external tools (Linear, Context7, etc.)

**Pros:**
- Polished UX — designed for managing 3-5 concurrent agents
- Worktree management is fully automated
- Checkpointing solves the "agent went off the rails" problem
- Native macOS performance

**Cons:**
- macOS only (Apple Silicon only for now)
- Closed source — can't extend or self-host
- Desktop app — can't access from other devices
- No task/project management built in (it's a "session runner", not a "project manager")

**What Holophyte can learn:**
- Checkpointing is a killer feature — snapshot git + conversation state
- Setup scripts per repo are essential for worktree-based workflows
- Diff viewer as primary review mechanism (not raw terminal output)

---

### 1.2 Vibe Kanban (Web — Closest Competitor)

- **Website:** https://www.vibekanban.com
- **GitHub:** https://github.com/BloopAI/vibe-kanban
- **Docs:** https://www.vibekanban.com/docs/agents/claude-code

**How it works:**
- Kanban board with parallel agent execution
- Each task runs in its own git worktree
- Supports multiple coding agents across different projects
- Web-based UI

**Pros:**
- Very similar concept to Holophyte — kanban-driven agent orchestration
- Git worktree isolation per task
- Multi-agent support (not just Claude Code)

**Cons:**
- Less mature real-time infrastructure (Holophyte uses Convex)
- Less polished terminal experience

**What Holophyte can learn:**
- Multi-agent support (Codex, Aider, etc.) broadens the audience
- Their worktree-per-task model validates Holophyte's direction

---

### 1.3 Claude-Code-Board (Web — Kanban)

- **GitHub:** https://github.com/cablate/Claude-Code-Board

**How it works:**
- Kanban WebUI for managing Claude Code sessions
- Multiple simultaneous AI coding sessions
- Workflow automation and agent-based prompting
- Intelligent project organization

**Pros:**
- Web-based kanban approach (same category as Holophyte)
- Workflow automation features

**Cons:**
- Less sophisticated real-time infrastructure
- Smaller community

---

### 1.4 Claude Squad (TUI — Go)

- **GitHub:** https://github.com/smtg-ai/claude-squad
- **Website:** https://smtg-ai.github.io/claude-squad/

**How it works:**
- Terminal UI (TUI) for managing multiple AI agents
- tmux for session isolation
- Git worktrees for workspace isolation
- Supports Claude Code, Aider, Codex, OpenCode, Amp
- Experimental "autoyes" (yolo) mode for unattended execution

**Pros:**
- Lightweight — no browser needed
- Multi-agent support
- tmux gives rock-solid session persistence
- Active community (most starred in this category)

**Cons:**
- TUI only — no web access, no mobile
- Go codebase (different ecosystem from Holophyte's TypeScript)
- No project management / kanban features

**What Holophyte can learn:**
- "Autoyes" mode for trusted/automated tasks is a great feature
- tmux's session persistence model is worth studying for reliability

---

### 1.5 Crystal (Desktop — Electron)

- **GitHub:** https://github.com/stravu/crystal

**How it works:**
- Electron desktop app (TypeScript + React)
- Supports both Claude Code and Codex
- Sessions from prompts in isolated worktrees
- Built-in diff viewer + squash/rebase operations
- Commit history preservation between iterations

**Pros:**
- TypeScript + React (same stack as Holophyte's frontend)
- Diff viewer + git operations built in
- Cross-platform via Electron

**Cons:**
- Electron overhead
- Desktop-only
- No kanban/project management

---

### 1.6 Agent Viewer (Web — Kanban + tmux)

- **GitHub:** https://github.com/hallucinogen/agent-viewer

**How it works:**
- Kanban board for managing Claude Code agents running in tmux sessions
- Spawn, monitor, and interact with agents from a single web UI

**Pros:**
- Web-based kanban + tmux backend (hybrid approach)
- Simple, focused feature set

**Cons:**
- Requires tmux on the host
- Less polished than Conductor/Crystal

---

### 1.7 Other Notable Tools

| Tool | Type | Link | Notes |
|------|------|------|-------|
| **claude-flow** | Framework | https://github.com/ruvnet/claude-flow | Leading orchestration platform, MCP-native |
| **ccswarm** | CLI | https://github.com/nwiizo/ccswarm | Worktree isolation + specialized agents |
| **multi-agent-shogun** | CLI | https://github.com/yohey-w/multi-agent-shogun | Samurai-themed hierarchy, agents communicate via YAML on disk |
| **agent-os** | Web | https://github.com/saadnvd1/agent-os | Mobile-first web UI, multi-pane terminals |
| **agent-deck** | TUI | https://github.com/asheshgoplani/agent-deck | Rust TUI, optional Docker sandboxing |
| **remote-code** | Web | https://github.com/vanna-ai/remote-code | Remote agent management, secure tunnels |
| **Companion** | Web | https://github.com/The-Vibe-Company/companion | Reverse-engineered WS protocol, uses existing subscriptions |
| **claude-code-web-ui** | Web | https://github.com/lennardv2/claude-code-web-ui | Nuxt 4, voice input, drag-and-drop images |
| **opcode** | Desktop | https://github.com/winfunc/opcode | GUI + toolkit for Claude Code |

### 1.8 Commercial / Proprietary Competitors

| Tool | Approach | Key Insight |
|------|----------|-------------|
| **Devin** (devin.ai) | Up to 10 concurrent sessions in isolated VMs | Strongest isolation model (full VMs per agent) |
| **Cursor 2.0** | Up to 8 agents in worktrees or remote VMs | IDE-native multi-agent with "Composer Tasks" |
| **Windsurf Wave 13** | Parallel Cascade panes + worktrees | Side-by-side agent panes in IDE |
| **GitHub Copilot Agent HQ** | Background agents with worktrees | Agents work on issues asynchronously |
| **Replit Agent 3** | Multi-agent: manager + editor agents | Manager oversees, editors handle specific tasks |

---

## 2. Claude Agent SDK — The Big Opportunity

- **npm:** `@anthropic-ai/claude-agent-sdk`
- **Docs:** https://platform.claude.com/docs/en/agent-sdk/overview
- **Quickstart:** https://platform.claude.com/docs/en/agent-sdk/quickstart
- **TypeScript SDK:** https://github.com/anthropics/claude-agent-sdk-typescript
- **Python SDK:** https://github.com/anthropics/claude-agent-sdk-python
- **Demos:** https://github.com/anthropics/claude-agent-sdk-demos
- **Blog:** https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk

### What It Is

The official programmatic interface for embedding Claude Code's capabilities. It gives you the same tools, agent loop, and context management that power Claude Code, but as a TypeScript/Python API instead of a CLI.

The Claude Code CLI is **bundled with the SDK package** — no separate installation required.

### Core API

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

for await (const message of query({
  prompt: 'Find and fix the bug in auth.py',
  options: {
    allowedTools: ['Read', 'Edit', 'Bash'],
    // Hooks for intercepting agent behavior
    // MCP servers for external tools
    // Subagents for parallel subtasks
    // Session management for persistence
  }
})) {
  // Each `message` is a structured, typed object
  // Not raw terminal output with ANSI codes
}
```

### SDK vs PTY Spawning (Current Holophyte Approach)

| Aspect | PTY Spawning (current) | Agent SDK |
|--------|----------------------|-----------|
| **Output format** | Raw ANSI terminal output | Structured typed messages |
| **Progress tracking** | Parse terminal text | Hooks (`PreToolUse`, `PostToolUse`, `Stop`) |
| **Tool approval** | Terminal prompts in xterm.js | `canUseTool` callback → custom UI |
| **Token/cost data** | Not available | Built-in per-session tracking |
| **Session resume** | Restart CLI process | `session.resume(sessionId)` |
| **Subagents** | Spawn separate processes | Native SDK support, isolated contexts |
| **MCP integration** | CLI config files | Programmatic `mcpServers` option |
| **Terminal experience** | Full interactive terminal | No terminal — custom message renderer |
| **Complexity** | Simple (spawn + pipe) | More setup, much more powerful |

### Key SDK Features

**Hooks** (https://platform.claude.com/docs/en/agent-sdk/hooks):
- `PreToolUse` — intercept before a tool runs (block, modify, log)
- `PostToolUse` — react after a tool completes
- `UserPromptSubmit` — intercept prompt submission
- `Stop` — when agent session ends
- `PreCompact` — before context compaction

**Subagents** (https://platform.claude.com/docs/en/agent-sdk/subagents):
- Spawn specialized sub-agents with isolated context windows
- Define agent "roles" with specific tool sets
- Example: a "code-reviewer" subagent with only Read/Glob/Grep

**Sessions** (https://platform.claude.com/docs/en/agent-sdk/sessions):
- Automatic session creation with IDs
- Resume sessions with full conversation history
- Fork sessions to explore different approaches

**MCP** (https://platform.claude.com/docs/en/agent-sdk/mcp):
- Connect to external tools (Playwright, databases, APIs)
- Define MCP servers programmatically

**Permissions** (https://platform.claude.com/docs/en/agent-sdk/permissions):
- `bypassPermissions`, `acceptEdits`, `default` modes
- `canUseTool` callback for runtime approval decisions
- Granular allow/deny rules per tool

**Cost Tracking** (https://platform.claude.com/docs/en/agent-sdk/cost-tracking):
- Per-model token breakdown (input, output, cache read, cache write)
- Cost in USD
- Context window utilization

### Pros of Migrating to SDK

- **Rich Kanban integration**: Hook into every tool call → update task progress in real-time
- **Approval UI**: Replace terminal-based "y/n" prompts with proper UI buttons
- **Cost dashboard**: Show per-task token usage and cost
- **Structured logs**: Store every agent action in Convex for replay/debugging
- **Session persistence**: Store session IDs in Convex, resume across browser refreshes

### Cons of Migrating to SDK

- **No terminal emulation**: Lose the full xterm.js experience
- **Custom renderer needed**: Must build a message/action renderer UI
- **Learning curve**: New API surface to learn
- **Potential breaking changes**: SDK is relatively new

### Recommended Implementation: Hybrid Approach

Keep both modes:
1. **Terminal mode** (current PTY): For users who want the full interactive Claude Code experience
2. **SDK mode** (new): For structured tasks, automation, and the richer Kanban integration

This way users can choose: "run interactively" vs "run and track progress." The SDK mode feeds structured data into the Kanban UI (progress, tool calls, diffs, costs), while terminal mode gives the raw power of Claude Code CLI.

**Implementation steps:**
1. `bun install @anthropic-ai/claude-agent-sdk`
2. Create `src/claude/sdk-session.ts` alongside existing `manager.ts`
3. Add a "mode" toggle per task: "Interactive" (PTY) vs "Managed" (SDK)
4. In SDK mode, stream structured messages to frontend via WebSocket
5. Build a message renderer component (tool calls, diffs, progress)
6. Store session IDs in Convex `sessions` table for resume capability
7. Wire up hooks to update task status in Convex automatically

---

## 3. Isolation Strategies

### 3.1 Git Worktrees (Dominant Pattern)

- **Docs:** https://git-scm.com/docs/git-worktree
- **Guide:** https://medium.com/@dtunai/mastering-git-worktrees-with-claude-code-for-parallel-development-workflow-41dc91e645fe
- **incident.io writeup:** https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees

**What it is:**
A git worktree is a separate checkout of the same repository. Each worktree has its own working directory and branch, but shares the same `.git` database. This means you get full filesystem isolation without cloning the entire repo.

```bash
# Create a worktree for a task
git worktree add ../holophyte-task-42 feat/task-42

# Agent works in ../holophyte-task-42/
# Main repo is unaffected

# Clean up when done
git worktree remove ../holophyte-task-42
```

**Pros:**
- Full filesystem isolation (agents can't step on each other's files)
- Lightweight — shares `.git` database, only creates working files
- Standard git tooling — PRs, diffs, merges all work normally
- Used by Conductor, Claude Squad, Crystal, Vibe Kanban, Cursor, Windsurf, GitHub Copilot

**Cons:**
- Each worktree needs its own `node_modules/` (or symlink), `.env`, build artifacts
- Bootstrapping overhead: `bun install` + setup per worktree (mitigated by setup scripts)
- Submodules have incomplete worktree support
- Disk space: each worktree duplicates working files
- Requires the repo to be cloned locally

**Implementation for Holophyte:**
1. When starting a task session, optionally create a worktree: `git worktree add <path> -b <branch>`
2. Run repo-specific setup script (install deps, copy `.env`, etc.)
3. Spawn Claude Code (PTY or SDK) with `cwd` set to worktree path
4. On completion: create PR from worktree branch, then `git worktree remove`
5. Store worktree path in Convex `sessions` table

**Key consideration:** Make worktrees optional. For quick fixes, running in the main checkout is fine. For parallel feature work, worktrees prevent conflicts.

### 3.2 GitButler's Hook-Based Approach (No Worktrees)

- **Blog:** https://blog.gitbutler.com/parallel-claude-code

**What it is:**
Instead of worktrees, use Claude Code's lifecycle hooks to automatically assign file changes to branches. When Claude starts editing, a hook creates a branch. All file modifications during that session go to that branch.

**Pros:**
- No bootstrapping overhead (no `bun install` per worktree)
- All sessions share the same `node_modules/`, `.env`, etc.
- Simpler setup

**Cons:**
- Less isolation — file conflicts are still possible if two agents edit the same file
- Requires Claude Code hook support
- Less proven at scale than worktrees

**Verdict:** Worktrees are safer for Holophyte's use case (parallel tasks). Hook-based approach is a good lightweight alternative for repos where setup overhead is too high.

### 3.3 Docker / MicroVM Isolation

- **E2B:** https://e2b.dev/docs (Firecracker microVMs, 150ms spin-up)
- **gVisor:** https://gvisor.dev (user-space kernel, syscall interception)

**What it is:**
Each agent runs in its own container or microVM, providing kernel-level isolation.

**Pros:**
- Strongest isolation (filesystem, network, process)
- Can run untrusted code safely
- Reproducible environments

**Cons:**
- Significant infrastructure overhead
- Slower startup than worktrees
- Overkill for most single-user setups
- Requires Docker/VM runtime on host

**Verdict:** Overkill for Holophyte v1. Consider for a future "cloud hosted" mode where untrusted users run agents.

---

## 4. Terminal Streaming & WebSocket Patterns

### 4.1 Backpressure Management

- **Guide:** https://skylinecodes.substack.com/p/backpressure-in-websocket-streams
- **WebSocketStream API:** https://developer.chrome.com/docs/capabilities/web-apis/websocketstream

**The problem:**
When Claude Code produces output faster than the browser can render it (e.g., dumping a large file), WebSocket buffers fill up. Without backpressure handling, this causes memory bloat and UI freezes.

**Current Holophyte risk:** With multiple concurrent PTY sessions streaming to one browser, this can compound.

**Solutions:**
1. **Bounded buffering**: Set max buffer size on the server. When full, drop older frames or pause the PTY
2. **Write coalescing on xterm.js**: Buffer incoming data for up to 16ms before writing to the terminal. This prevents frame-per-byte rendering
3. **WebSocketStream API**: Modern API with built-in backpressure (Chrome only for now)
4. **Message broker**: For production scale, use Redis Pub/Sub between PTY and WebSocket server

**Implementation for Holophyte:**
- Add a send buffer per WebSocket connection in `server.ts`
- Implement write coalescing: accumulate PTY output for ~16ms, then flush as a single WebSocket frame
- Track buffer size per connection; if over threshold, throttle the PTY (pause reading)
- This is especially important when multiple terminals are open

### 4.2 xterm.js Performance

- **Flow control guide:** https://xtermjs.org/docs/guides/flowcontrol/
- **Performance issue:** https://github.com/xtermjs/xterm.js/issues/791

**Key numbers:**
- A 160x24 terminal with 5000 scrollback uses ~34MB of memory
- Data processing should take < 16ms (one frame) to stay smooth
- GPU-accelerated rendering (WebGL addon) helps significantly

**Recommendations for Holophyte:**
- Use the `@xterm/addon-webgl` for GPU rendering (already may be using this)
- Limit scrollback buffer per terminal (e.g., 5000 lines)
- When a terminal is not visible (tab in background), pause rendering and buffer data
- Consider the `@xterm/addon-serialize` for saving/restoring terminal state

### 4.3 Reconnection & Recovery

- **Guide:** https://oneuptime.com/blog/post/2026-01-24-websocket-reconnection-logic/view

**The problem:**
Network blips, laptop sleep, or browser tab hibernation can kill WebSocket connections. The PTY keeps running, but the frontend loses the stream.

**Implementation for Holophyte:**
1. Server: buffer the last N bytes of PTY output per session (ring buffer)
2. On WebSocket reconnect, replay the buffer so the terminal state is restored
3. Use exponential backoff with jitter for reconnection attempts
4. Show a "Reconnecting..." overlay on the terminal component
5. Store the terminal's serialized state periodically for full recovery

---

## 5. Agent Lifecycle Management

### 5.1 Start / Pause / Resume / Stop / Retry

**Current Holophyte model:** Start and Stop (via PTY spawn/kill). No pause, resume, or retry.

**What competitors do:**
- **Conductor:** Checkpointing (snapshot and restore to any prior state)
- **Claude Squad:** tmux session detach/reattach (natural pause/resume)
- **Devin:** Persistent VMs that survive disconnections

**Recommended lifecycle for Holophyte:**

```
                  +-----------+
                  |  Created  |
                  +-----+-----+
                        |
                   start task
                        |
                  +-----v-----+
             +--->|  Running   |<---+
             |    +-----+-----+    |
             |          |          |
          resume     stop/error  retry
             |          |          |
             |    +-----v-----+   |
             +----|  Stopped   |---+
                  +-----+-----+
                        |
                   archive/delete
                        |
                  +-----v-----+
                  |  Archived  |
                  +-----------+
```

**Implementation:**
- **Start**: Spawn PTY or SDK session, set task status to "in-progress"
- **Stop**: Kill PTY process or end SDK session, keep output history
- **Resume**: Re-spawn agent with conversation context (SDK session resume, or re-feed prompt history for PTY)
- **Retry**: Stop current session, create new session with same prompt + "previous attempt failed because..."
- **Pause** (stretch goal): For SDK mode, pause the query iterator. For PTY, send SIGTSTP

### 5.2 Error Recovery

- **Guide:** https://sparkco.ai/blog/mastering-retry-logic-agents-a-deep-dive-into-2025-best-practices
- **Durable execution:** https://www.restate.dev/blog/durable-ai-loops-fault-tolerance-across-frameworks-and-without-handcuffs

**Patterns:**
- **Exponential backoff with jitter** for transient failures (API rate limits, network errors)
- **Circuit breaker** for persistent failures (if 3 consecutive tasks fail, pause and alert)
- **Dead letter queue** for tasks that fail after N retries (move to a "failed" column on kanban)

---

## 6. Task Queuing & Scheduling

### 6.1 Why You Need a Queue

When running multiple agents, you'll hit rate limits, memory limits, or just want to control concurrency. A task queue lets you:
- Limit concurrent agents (e.g., max 3 at a time)
- Prioritize urgent tasks
- Retry failed tasks automatically
- Drain gracefully on shutdown

### 6.2 Options

**In-process queue (simplest, recommended for v1):**
- Use a simple array/deque in `manager.ts`
- Process tasks FIFO with configurable concurrency limit
- No external dependencies

**Redis-based queue (for scale):**
- BullMQ (https://bullmq.io) or custom Redis Streams consumer
- Survives server restarts
- Distributed across multiple server instances

**Convex-based queue (fits Holophyte's stack):**
- Use Convex's real-time queries as a queue
- Tasks with status "queued" → pick up next available → set to "running"
- Already have Convex — no new infrastructure
- Natural fit: the kanban board IS the queue

**Recommended for Holophyte:** Start with Convex-based queuing. The kanban board already tracks task status. Add a `concurrencyLimit` setting per repo. When a task is moved to "in-progress" column, the server checks if there's capacity. If not, it stays "queued" and auto-starts when a slot opens.

---

## 7. Session Persistence & Checkpointing

### 7.1 Session Persistence

- **SDK sessions:** https://platform.claude.com/docs/en/agent-sdk/sessions
- **Headless mode continue:** https://code.claude.com/docs/en/headless

**The problem:**
If the server restarts or the user closes the browser, the agent's conversation context is lost (PTY mode). With the SDK, sessions can be resumed by ID.

**Implementation for Holophyte:**
1. Store session ID (from SDK or Claude Code's `~/.claude/` session files) in Convex `sessions` table
2. On server restart, reconnect to running PTY processes (or resume SDK sessions)
3. On browser reconnect, replay buffered terminal output
4. For PTY mode: periodically serialize terminal state with `@xterm/addon-serialize`

### 7.2 Checkpointing (Conductor's Killer Feature)

**What it is:**
Snapshot the entire state at a point in time: git state + conversation history + terminal output. Allow the user to "rewind" to any checkpoint.

**Implementation for Holophyte:**
1. At meaningful points (task start, before risky operations, on user request), create a checkpoint:
   - `git stash` or `git tag checkpoint-{timestamp}` on the worktree
   - Save conversation history to Convex
   - Save terminal output buffer
2. UI: Show a timeline of checkpoints on the task detail panel
3. "Rewind" button: restore git state, reload conversation, replay terminal

**This is a significant differentiator** — most tools don't offer this.

---

## 8. Cost Tracking & Observability

### 8.1 Token & Cost Tracking

- **SDK cost tracking:** https://platform.claude.com/docs/en/agent-sdk/cost-tracking
- **Managing costs:** https://code.claude.com/docs/en/costs

**Why it matters:**
Running 5 concurrent Claude Code sessions can burn through tokens fast. Users need visibility into cost per task, per repo, per day.

**Implementation for Holophyte:**
- **SDK mode:** Token usage comes for free in the message stream. Store per-session in Convex.
- **PTY mode:** Parse Claude Code's `--output-format json` or hook into `~/.claude/` usage files
- **Dashboard:** Show cost per task on the kanban card, daily/weekly aggregates on a dashboard
- **Alerts:** "This task has used $X so far" warning on the task card
- **Budget limits:** Optional max spend per task, auto-pause when reached

### 8.2 Observability

- **OpenTelemetry for AI:** https://opentelemetry.io/blog/2025/ai-agent-observability/
- **Langfuse integration:** https://langfuse.com/integrations/frameworks/claude-agent-sdk
- **SigNoz monitoring:** https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/

**For v1, keep it simple:**
- Log every session start/stop/error to Convex
- Track token usage per session
- Show session duration and status on kanban cards

**For later:**
- OpenTelemetry traces per agent action
- Langfuse integration for detailed LLM observability
- Audit log of every tool call (stored in Convex)

---

## 9. Security & Sandboxing

### 9.1 Claude Code's Built-in Sandboxing

- **Docs:** https://code.claude.com/docs/en/sandboxing
- **Engineering blog:** https://www.anthropic.com/engineering/claude-code-sandboxing

Claude Code already has OS-level sandboxing:
- **macOS:** seatbelt (filesystem + network isolation)
- **Linux:** bubblewrap
- Reduces permission prompts by 84%

**For Holophyte:** Leverage this. When spawning Claude Code, enable sandboxing by default. In the SDK, use the `permissions` config to lock down tool access per task.

### 9.2 Permission Management in the UI

**Current state:** Claude Code's terminal-based "y/n" prompts are hard to manage across multiple sessions.

**With SDK mode:**
- `canUseTool` callback → show approval dialog in the Kanban UI
- Batch approve: "Allow all Read/Write for this task"
- Per-repo permission presets (e.g., "this repo can run tests but not deploy")

**Implementation:**
1. Define permission profiles: "Read-only", "Standard" (read + edit + test), "Full" (everything)
2. Assign a profile per task or per repo
3. For SDK mode, implement `canUseTool` to check the profile
4. For PTY mode, use `--allowedTools` CLI flag

---

## 10. Ideas to Make Holophyte Stand Out

### What Holophyte Already Does Well

- **Web-based** (not desktop-only like Conductor/Crystal, not TUI like Claude Squad)
- **Kanban-first** (task board drives agent orchestration)
- **Convex real-time** (instant UI updates, no polling)
- **Bun native PTY** (lighter weight than Electron + node-pty)

### Ideas for Differentiation

#### 10.1 Focus Mode / ADHD-Friendly UX

**The problem:** With multiple agents running, it's easy to get overwhelmed. Context-switching kills productivity, especially with ADHD. Most tools show everything at once (5 terminals, 10 file changes, 3 PR reviews).

**The solution — "Focus Mode":**
- **Single-task view**: One task fills the screen. Terminal + diff + task description. No other distractions.
- **Smart notifications**: Only interrupt for decisions that block progress (tool approvals). Everything else queues silently.
- **Progress rings**: Each kanban card shows a subtle progress ring (spinner when active, checkmark when done). Glanceable without opening anything.
- **"What needs my attention?" panel**: A prioritized list of agent-generated events that need human input. Clear each one, then go back to your task. Think of it as an "inbox zero" for agent events.
- **Keyboard-first navigation**: `j`/`k` to move between tasks, `Enter` to focus, `Esc` to zoom out. Vim-like efficiency for power users.
- **Pomodoro-compatible mode**: Start a focus timer. During the timer, agents work autonomously (auto-approve safe operations). When the timer ends, review what happened.

**Why this stands out:** No competitor focuses on the human's attention management. They all assume you're watching 5 terminals. Holophyte could be the tool that *respects your attention* while agents work in the background.

#### 10.2 Structured Task Prompts with Templates

**The problem:** Writing good prompts for coding agents is a skill. Most people write vague prompts ("fix the login bug") that lead to poor results.

**The solution:**
- **Prompt templates** per task type: "Bug Fix", "New Feature", "Refactor", "Test", "Review"
- Each template includes structured fields:
  - **What**: Description of the change
  - **Where**: Files/areas to focus on
  - **Constraints**: What NOT to change, performance requirements, etc.
  - **Acceptance criteria**: How to know it's done
  - **Context**: Links to issues, PRs, docs
- Templates auto-generate a well-structured prompt from the fields
- Users can create custom templates per repo

**Why this stands out:** Reduces cognitive load. Instead of staring at a blank prompt field, you fill in structured fields. The template handles the prompt engineering.

#### 10.3 Agent Activity Feed (Not Just Terminals)

**The problem:** Raw terminal output is noisy. 90% of it is irrelevant to the human (file reads, grep results, etc.). What you care about is: what did the agent *do*?

**The solution — Activity Feed:**
- A clean, chronological feed of agent *actions* (not raw output):
  - "Read `src/auth/login.ts` (247 lines)"
  - "Edited `src/auth/login.ts` lines 42-58"
  - "Ran `bun test src/auth/login.test.ts` — 3 passed, 1 failed"
  - "Created file `src/auth/utils.ts`"
- Each action is expandable (click to see the actual diff, test output, etc.)
- Color-coded by type (read=gray, edit=blue, test=green/red, command=orange)
- Filter by type: "Show me only edits and test results"
- The terminal is still available but secondary — one click to switch to raw terminal view

**Why this stands out:** This is the middle ground between "raw terminal" and "no terminal." Most competitors go all-in on one approach. Holophyte can offer both, with the activity feed as the default for managed/SDK-mode tasks.

#### 10.4 Smart Task Decomposition

**The problem:** Users create big, vague tasks ("build the auth system"). These are hard for agents and hard for humans to track.

**The solution:**
- When a user creates a task, offer to run a quick "planning pass" (a lightweight Claude call)
- The planning pass breaks the big task into smaller subtasks on the kanban board
- Each subtask has a clear scope and can be assigned to a separate agent
- Subtasks are linked to the parent task with a progress tracker
- The user reviews/edits the breakdown before any agents start

**Why this stands out:** Most tools just run whatever prompt you give them. Holophyte could guide users toward better-scoped tasks, leading to better results and less wasted compute.

#### 10.5 Diff Review Dashboard

**The problem:** After an agent finishes, you need to review what it did. Most tools dump you into `git diff` or a terminal. Reviewing multiple agents' changes is tedious.

**The solution:**
- **Per-task diff view**: See all changes an agent made, organized by file
- **Inline comments**: Comment on specific lines (like a PR review)
- **Accept/Reject per hunk**: Approve individual changes, not all-or-nothing
- **Cross-task diff view**: See changes across all active tasks to spot conflicts early
- **One-click PR creation**: When you approve changes, auto-create a PR with the task description as the PR body

**Why this stands out:** Conductor has basic diff review. Holophyte can go further with inline comments, per-hunk approval, and cross-task conflict detection.

#### 10.6 Repo Setup Profiles ("Blueprints")

**The problem:** Every time you add a repo, you need to configure: how to run tests, how to lint, what branches to protect, what env vars to set, what setup script to run for worktrees, etc.

**The solution — Blueprints:**
- Predefined configurations per project type (Next.js, Bun, Python, Go, etc.)
- Auto-detect project type from `package.json`, `pyproject.toml`, etc.
- Blueprint includes: test command, lint command, build command, setup script, agent permissions
- Custom blueprints: save your config as a template, reuse across repos
- Community blueprints: share configurations (stretch goal)

#### 10.7 Session Replay & Time Travel

**The problem:** When an agent produces bad output, it's hard to understand *why*. You see the end result but not the decision process.

**The solution:**
- Record every agent action with timestamps
- "Replay" button: watch the agent's work unfold step by step (like a screen recording, but structured)
- Scrub the timeline: jump to any point in the agent's work
- "Branch from here": rewind to a specific point and re-run with a different prompt
- Store replays in Convex for team learning ("watch how agent X solved problem Y")

**Why this stands out:** No competitor offers this. It's the debugging tool for agent-assisted development.

#### 10.8 Multi-Agent Support (Beyond Claude Code)

**The problem:** Not everyone uses Claude Code. Some teams use Aider, Codex, or other agents.

**The solution:**
- Agent adapters: define a common interface (`start`, `stop`, `sendInput`, `onOutput`)
- Ship with adapters for: Claude Code (PTY + SDK), Codex CLI, Aider, Gemini CLI
- The Kanban board is agent-agnostic — any agent can work on any task
- Compare: run the same task with different agents and compare results

**Why this stands out:** Claude Squad does this at the TUI level. Doing it in a web-based kanban with comparison features would be unique.

#### 10.9 Quick Capture & Task Inbox

**The problem:** Ideas for tasks come at random times. You don't want to stop what you're doing to create a full task with a proper prompt.

**The solution:**
- **Quick capture**: Global keyboard shortcut (or browser extension) to jot a quick task idea
- **Task inbox**: A temporary "inbox" column on the kanban. Quick captures land here.
- **Triage mode**: Periodically review the inbox. For each item: flesh out the prompt, assign priority, move to a column, or discard.
- **Voice capture**: Speak a task idea, auto-transcribe, drop in inbox (mobile-friendly)

**Why this stands out:** Addresses the ADHD "capture everything before you forget" need. GTD-inspired workflow that no coding agent tool offers.

#### 10.10 Agent Collaboration / Handoffs

**The problem:** Complex tasks might need multiple agents working sequentially (one writes code, another writes tests, another reviews).

**The solution — Agent Pipelines:**
- Define a pipeline: e.g., "Implement" → "Test" → "Review"
- Each stage is a separate agent with a specific prompt and role
- Output from one stage feeds into the next
- The kanban card moves through columns as the pipeline progresses
- Users can intervene at any stage (review between stages)

**Why this stands out:** Most tools run one agent per task. Pipelines enable higher-quality output through specialization and review gates.

#### 10.11 Contextual Repo Intelligence

**The problem:** Every time an agent starts, it has to "learn" the codebase from scratch (read files, understand patterns). This wastes tokens and time.

**The solution:**
- **Repo index**: On repo setup, generate a lightweight index (key files, architecture summary, test patterns, style guide)
- **Auto-inject context**: When an agent starts a task, prepend the repo index to its system prompt
- **CLAUDE.md auto-generation**: Analyze the repo and generate/update a CLAUDE.md with project conventions
- **Learning over time**: Track which files agents read most often → include them in the index

#### 10.12 Notifications & Async Workflow

**The problem:** You start 3 agents, go do something else, and forget to check back.

**The solution:**
- **Desktop notifications** when an agent finishes, fails, or needs approval
- **Webhook integrations**: Slack, Discord, email notifications
- **Daily digest**: "Your agents completed 5 tasks, 1 needs review, 2 are running"
- **Mobile-responsive UI**: Check on agents from your phone

**Why this stands out:** Enables a truly async workflow. Start agents, walk away, get notified when human input is needed.

---

## Summary: Priority Roadmap

### Phase 1 — Quick Wins (Low Effort, High Impact)
- [ ] Git worktree support per task (optional)
- [ ] Setup scripts per repo
- [ ] WebSocket reconnection with buffer replay
- [ ] Keyboard shortcuts for kanban navigation
- [ ] Quick capture / task inbox
- [ ] Progress indicators on kanban cards

### Phase 2 — SDK Integration (Medium Effort, Transformative)
- [ ] Claude Agent SDK integration (hybrid mode)
- [ ] Activity feed for SDK-mode tasks
- [ ] Structured prompt templates
- [ ] Per-task cost tracking
- [ ] Permission profiles per repo/task

### Phase 3 — Differentiation (Higher Effort, Unique Value)
- [ ] Focus mode / ADHD-friendly UX
- [ ] Smart task decomposition (planning pass)
- [ ] Diff review dashboard with inline comments
- [ ] Session replay & time travel
- [ ] Checkpointing (git + conversation snapshots)

### Phase 4 — Scale & Ecosystem
- [ ] Multi-agent support (Codex, Aider adapters)
- [ ] Agent pipelines (implement → test → review)
- [ ] Notifications (desktop, Slack, email)
- [ ] Repo blueprints
- [ ] Contextual repo intelligence / auto-CLAUDE.md
