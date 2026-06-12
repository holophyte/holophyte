# Holophyte TUI — Attention Queue

**Status**: draft v1 · 2026-06-09
**Command**: `holo`
**Stack**: bun + TypeScript + OpenTUI (`@opentui/core` / `@opentui/react`, React 19) — same stack as bramble
**Location**: `holophyte/tui/` — self-contained package inside the holophyte repo

## Vision

Holophyte pivots from orchestrator to **attention layer**. Coding agents (Claude Code, Codex, later Cursor/Devin) run in plain tmux windows; Holophyte answers one question: **what should I look at next?**

The queue is the product. tmux is an implementation detail. Holophyte is not a kanban board, an agent framework, or a wrapper that hides the agents — you always interact with the raw agent CLI in its own tmux window.

Primary constraint: ADHD attention management. The user should never scan panes wondering what needs them; the next decision surfaces automatically, cheap decisions are answerable without a context switch, and idle time is explicit ("all agents running") rather than ambiguous.

## Architecture

```
holo (CLI entry)
├── holod (daemon)                 # Unix socket server, owns all state
│   ├── session registry           # sessions, lifecycle states, queue
│   ├── scoring engine             # deterministic priority (see Queue)
│   └── state file                 # survives daemon restarts
├── TUI (OpenTUI app)              # renders daemon state, sends commands
└── hook adapters                  # per-agent lifecycle integration
    ├── claude (v1)
    ├── codex (v1)
    └── cursor / devin (post-v1, adapter files only)

tmux session "holo"
├── window 0: TUI
├── window 1: claude-1
├── window 2: codex-1
└── window N: ...
```

- **Daemon is separate from the TUI.** Queue state survives the TUI closing; hooks always have a listener; the daemon is where Convex sync attaches later.
- **One tmux session, one window per agent session.** Jump = `select-window`. Sessions survive everything (daemon, TUI, terminal crashes) because tmux owns the processes.
- **TUI is a full-screen app in window 0.** No terminal embedding in v1 — see Layout.

## State detection (no output scraping)

Lifecycle states per session: `running | needs_input | permission | idle | error | exited`.

All transitions come from **agent-native hooks** calling `holo hook <event>` which writes to the daemon socket. This is the cmux-validated pattern (see holophyte-thoughts wiki: cmux research). Never parse pane output for state.

### Claude Code adapter (v1)

Spawn-time injection — `holo` launches `claude --session-id <id> --settings <generated-hooks.json>`. No global shim needed since every session is spawned by us. Hook map:

| Hook | Transition |
|---|---|
| `UserPromptSubmit` | → `running` |
| `PreToolUse` | → `running` (clears needs_input); `AskUserQuestion` special-cased → `needs_input` with question text |
| `Notification` | → `needs_input` (carries reason) |
| `PermissionRequest` | → `permission` — **synchronous** hook with timeout; the daemon holds the request open so the TUI can answer it remotely (approve/deny from the queue, no attach) |
| `Stop` | → `idle` (work complete — review/next-prompt item) |
| `SessionEnd` | → `exited` + cleanup (covers Ctrl+C where Stop never fires) |

Set `preferredNotifChannel: notifications_disabled` in injected settings so hooks are the single signal source.

Known edge cases (handle in v1): stale `Stop` arriving after a newer prompt started (guard by timestamp/session-id), Ctrl+C cleanup, daemon down when a hook fires (hook must fail silently and fast — never block the agent).

### Codex adapter (v1)

Per-session injection at spawn via CLI config overrides (`codex -c notify=[...]` etc.) — **never write to global `~/.codex/config.toml`**: Ko's global `notify` is already claimed by Codex Computer Use, and holo must not clobber it. Signals:

- `notify` fires on turn-complete and approval-needed only — no prompt-submit or session-end. Map: turn-complete → `idle`, approval-needed → `needs_input`.
- Codex hooks (`hooks.json`-style, per cmux) may provide richer lifecycle events; **verify what codex-cli 0.137+ actually supports against current docs before building** — don't trust secondhand research.
- If no prompt-submit signal exists: infer `running` when holo jumps the user into the session (or on `holo next` away from it), corrected by the next turn-complete. Lossy but honest.
- No synchronous permission hook — approvals degrade to `needs_input` + jump (capabilities.remotePermission = false).

### Adapter interface

```ts
interface HarnessAdapter {
  id: "claude" | "codex" | "cursor" | "devin"
  spawnCommand(session: Session): string[]   // argv with hook injection
  setup?(): Promise<void>                    // global config writes, if unavoidable
  capabilities: { remotePermission: boolean; questionText: boolean }
}
```

Cursor/Devin are out of scope for v1 but must require only a new adapter file.

## Data model

```ts
interface Session {
  id: string            // "claude-1", "codex-2"
  harness: HarnessId
  cwd: string           // repo path
  tmuxWindow: string
  status: "running" | "needs_input" | "permission" | "idle" | "error" | "exited"
  attentionReason?: string   // "Approve database migration", "Clarify naming convention"
  lastMessage?: string       // agent's last output message (from Stop/Notification payload)
  pendingPermission?: { tool: string; input: unknown; respondBy: number }
  createdAt: number
  statusSince: number        // drives elapsed display + aging bonus
}
```

State file: `~/.holo/state.json` (daemon-owned). Socket: `~/.holo/holod.sock`. Generated per-session hook settings: `~/.holo/sessions/<id>/settings.json`.

## Socket protocol

Newline-delimited JSON over the Unix socket. Two client kinds:

- **Hooks / CLI** (request-response): `{cmd: "hook", sessionId, event, payload}`, `{cmd: "ls"}`, `{cmd: "new", harness, cwd}`, `{cmd: "next"}`, `{cmd: "respondPermission", sessionId, allow: boolean}`. Hook calls must return in <50ms (write + ack); never block the agent.
- **TUI** (subscription): `{cmd: "subscribe"}` → daemon pushes full state snapshot, then `{type: "state", sessions, queue}` on every change. No polling.

**Synchronous permission flow**: the `PermissionRequest` hook process connects and *stays connected* waiting for a decision. Daemon marks the session `permission`, pushes state to TUI subscribers. On `respondPermission` (or the agent-side timeout), daemon replies to the held hook connection with the allow/deny JSON the hook protocol expects, and the hook process exits with it. If the daemon is down, the hook exits silently → agent falls back to its own prompt in the pane (degrades to a jump-and-answer item).

## Queue

Queue = sessions in `permission | needs_input | idle | error`, scored deterministically (adapted from the Decision Queue spec in holophyte-thoughts):

```
score = effortWeight + agingBonus + urgencyBonus
  effortWeight: permission 100, needs_input 60, error 50, idle 30   // quick wins first
  agingBonus:   +2/min waiting, capped +40
  urgencyBonus: reserved (0 in v1)
```

Permissions jump the queue — they're 2-second decisions blocking an agent. No LLM in the scoring path (Pi cut from v1). No red/expiring/panic UI — dopamine-safe per the Decision Queue spec.

## UI

Layout (per Ko's mockup, adapted to no-terminal-embedding):

```
┌──────────────┬─────────────────────────────────────┐
│ SESSIONS     │                                     │
│ ● relos/cdx  │   Preview of selected queue item:   │
│   needs 15m  │                                     │
│ ○ hermes/cl  │   - attention reason                │
│   running 42m│   - agent's last message (text)     │
│              │   - git diff --stat                 │
│ QUEUE        │   - pending permission card         │
│ 1. relos/cdx │     [a]pprove  [d]eny               │
│    approve…  │                                     │
│ 2. hermes…   │                                     │
│              │                                     │
│ CONTEXT      │                                     │
│ why/what/    │                                     │
│ last update  │                                     │
├──────────────┴─────────────────────────────────────┤
│ n:new  enter:open  j/k:nav  a/d:perm  q:quit       │
└─────────────────────────────────────────────────────┘
```

- **SESSIONS**: all sessions, including running — never hide what's alive. Status dot, harness, elapsed-in-state.
- **QUEUE**: scored needs-attention subset. Top item is "the next thing".
- **Preview/CONTEXT**: enough to often act *without attaching* — reason, last message, diff stat, permission card.
- **Empty queue is explicit**: "All N agents running — nothing needs you." Never a blank screen.
- The main area is a text preview, **not** an embedded live terminal. Post-v1 may approximate the mockup's embedded view via tmux `swap-pane` layouts.

### Keys (TUI window only — zero key capture inside agent windows)

| Key | Action |
|---|---|
| `j/k` | navigate queue/sessions |
| `enter` | jump to session's tmux window |
| `n` | new session (harness + cwd picker) |
| `a` / `d` | approve/deny pending permission on selected item |
| `tab` | toggle focus sessions ↔ queue |
| `q` | quit TUI (daemon + sessions keep running) |

Focus model: keys are tmux-window-scoped. Inside an agent window you type into the raw agent; a tmux binding (default `prefix+Space`, configurable) returns to the TUI window from anywhere. `holo` installs this binding into the session.

### New Session flow (`n`)

Two-step modal overlay, optimized so the fast path is ~3 keystrokes (`n 1 enter`):

1. **Harness picker** — number keys or j/k. Unconfigured harnesses (cursor/devin) shown grayed, not hidden.
2. **Cwd picker** — ranked list (repos with active sessions → recent spawn targets → `~/Development/*` git repos) with fuzzy filter on top. `tab` for free-text path as escape hatch. Never force typing a path.

```
┌──────────────────────────────────────┐
│  New Session                         │
│                                      │
│  [1] claude     ●                    │
│  [2] codex      ●                    │
│  [3] cursor     ○ not configured     │
│  [4] devin      ○ not configured     │
│                                      │
│  1-4/j/k: pick   esc: cancel         │
└──────────────────────────────────────┘
                  ↓
┌──────────────────────────────────────────┐
│  New claude session — where?             │
│                                          │
│  > relos_                                │  ← fuzzy filter
│                                          │
│  [1] ~/Development/relos      ★ 2 active │
│  [2] ~/Development/holophyte  recent     │
│  [3] ~/Development/bramble               │
│      …                                   │
│                                          │
│  enter: spawn   esc: back   tab: path    │
└──────────────────────────────────────────┘
```

`enter` spawns, modal closes, focus jumps into the new session's tmux window — you spawn because you have a prompt in your head right now. (Jump-on-spawn configurable later.)

Post-v1: optional initial-prompt field on step two (`holo new claude --cwd relos -m "..."`) — fire-and-forget spawning without leaving the TUI. Needs adapter support for prompt injection at spawn.

### Notifications (post-v1, low priority)

Desktop notification when queue goes 0→1 while attached to an agent window. Not the focus now.

## CLI

```
holo                 # attach/start tmux session + TUI (starts daemon if needed)
holo new <harness> [--cwd <path>]
holo next            # jump to top queue item (scriptable / tmux-bindable)
holo ls              # session list, plain text
holo hook <event>    # internal: called by injected hooks
holo setup           # write codex hooks.json/config.toml, tmux binding
```

## v1 scope

In: daemon + socket, claude & codex adapters, session spawn, queue + scoring, TUI (sessions/queue/preview), remote permission approve for Claude, jump/next, state persistence, empty-state.
Out: Pi (naming/summaries/ranking), Convex sync, Cursor/Devin adapters, desktop notifications, embedded terminal rendering, GUI.

## Phases

1. **Daemon + Claude adapter**: spawn `claude-1` in tmux with injected hooks, daemon tracks state, `holo ls` shows it. (Testable headless — TDD the state machine and scoring.)
2. **TUI core**: sessions + queue + preview, `enter` jump, `n` spawn, `holo next`.
3. **Remote permission**: synchronous PermissionRequest plumbing → approve/deny from queue.
4. **Codex adapter** + edge-case hardening (stale events, crash recovery).
5. **Later**: Convex sync (daemon writes events → web UI reads), Pi summaries, Cursor/Devin, pane-embedded layout.

## Testing

State machine (hook event → transitions, stale-event guards), scoring, and registry persistence are pure logic — test-first with vitest. tmux/spawn integration behind a thin shell layer, faked in tests. TUI components get smoke render tests; the real validation is dogfooding.

**FakeAgent adapter (v1 deliverable)**: a `fake` harness whose spawn command is a small script that emits scripted hook events to the daemon socket (and optionally waits on stdin to simulate permission prompts). The fast suite and TUI tests run entirely on FakeAgent — no real agent binaries, no API usage. Real-Claude integration is a thin smoke layer: spawn interactive `claude` in a headless tmux session (pre-trusted cwd), drive it with `tmux send-keys`, assert daemon state transitions from real hook events. Sessions are interactive (not `-p`) — hooks behave identically; wait on the `SessionStart` hook for readiness rather than sleeping.

## References

- `holophyte-thoughts/raw/holophyte-tui-idea.md` — original vision doc
- `holophyte-thoughts/wiki/ux/decision-queue-feature-design-and-architecture.md` — scoring algorithm, ADHD design principles
- cmux (manaflow-ai/cmux) — hook-based detection pattern: wrapper-injected Claude hooks, four-state lifecycle, synchronous permission feed, OSC fallback
