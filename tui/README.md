# holo — attention queue for parallel coding-agent sessions

Coding agents (Claude Code, Codex) run in plain tmux windows; holo answers one
question: **what should I look at next?** The queue is the product — see
[spec.md](./spec.md) for the full design and
[docs/hooks-research.md](./docs/hooks-research.md) for the verified hook
schemas the adapters are built on.

## Quickstart

```bash
cd tui
bun install
bun src/index.tsx            # start daemon + tmux session + TUI, attach
bun src/index.tsx new claude # spawn a Claude session in the current repo
```

Optional: `bun link` in this directory registers the `holo` command globally.

Everything lives under `~/.holo/` (state.json, holod.sock, holod.log,
per-session generated hook settings). Override with `HOLO_HOME` (tests do).
The tmux session name is `holo` (`HOLO_TMUX_SESSION` overrides).

## How it works

```text
holo (CLI)
├── holod (daemon)        owns all state; Unix socket, NDJSON protocol
│   ├── registry          session lifecycle state machine (stale-event guards)
│   ├── scoring           deterministic queue priority
│   └── state file        survives daemon restarts
├── TUI (OpenTUI/React)   window 0 of the tmux session; renders daemon pushes
└── hook adapters         claude / codex / fake (cursor, devin = stubs)
```

- **State detection is hook-based — no output scraping.** `holo new` spawns the
  agent with injected hooks (`claude --settings <generated.json>`, codex `-c
  hooks.*` overrides). Each hook invocation runs `src/hook/main.ts`, which maps
  the harness payload to a normalized event and writes it to the daemon socket.
  If the daemon is down, hooks exit silently and fast — never blocking the agent.
- **Remote permission approval**: `PermissionRequest` hooks hold their socket
  connection open; the TUI's `a`/`d` answers them without attaching. On
  timeout/daemon-down the hook prints nothing and the harness falls back to its
  normal in-pane dialog.
- **Session end**: Claude's `SessionEnd` hook, plus a 5s tmux liveness sweep
  (codex has no end hook; the sweep also covers hard kills).
- **Resume**: exited sessions stay on the board (dim) for 30 minutes and are
  resumable with `r` — a fresh process in a fresh window continues the prior
  conversation (`claude --resume`, `codex resume`). Conversation ids are
  captured from each harness's `SessionStart` hook payload (`session_id`);
  harnesses without resume support (cursor/devin) reject the request with
  "harness cannot resume".
- **Queue scoring**: permission 100, needs_input 60, error 50, idle 30, plus
  +2/min waiting (capped +40). Quick wins first; no panic UI.
- **Ambient status line**: holod owns the holo tmux session's `status-right`
  (session-scoped — your global tmux config is untouched), so attention counts
  and the top queue item are visible in every agent window. It's pushed on
  every state change, re-asserted each 5s sweep (heals a recreated session),
  and reset to "holod stopped" on graceful daemon stop.
- **Empty board = splash**: with zero sessions the main pane shows the
  holophyte sprout splash, and on first connect to an empty board the
  new-session picker opens automatically — `esc` dismisses it and it will not
  reopen on its own (press `n` to bring it back).
- **Per-agent-window sidebar**: each agent window gets a 30-col live board pane
  (`holo sidebar`) beside the agent, so you can see and act on the queue without
  jumping back to the TUI. The agent pane carries a tmux-native death trap (a
  pane-scoped `pane-died` hook + `remain-on-exit`) so the whole window — sidebar
  included — still dies the moment the agent process exits; holod's liveness
  sweep is unchanged. The sidebar is skipped when the window is narrower than
  111 cols (it needs 80 for the agent + 1 separator + 30) or when
  `HOLO_SIDEBAR=0` is set on the daemon's environment. The width is read at
  spawn time, so a session started while a wide-terminal client is attached
  (the usual `n`-in-the-TUI path) gets a sidebar; one spawned via `holo new`
  against a still-detached session sees tmux's 80-col default and is skipped.

## TUI keys (window 0 only — zero key capture inside agent windows)

| Key | Action |
|---|---|
| `j/k` (or arrows) | navigate queue/sessions |
| `enter` | jump to session's tmux window |
| `n` | new session (harness picker → fuzzy cwd picker) |
| `a` / `d` | approve / deny pending permission on selected item |
| `r` | resume an exited session — continues the conversation in a fresh window |
| `tab` | toggle focus sessions ↔ queue |
| `q` | quit TUI (daemon + sessions keep running) |

`prefix+Space` in tmux returns to the TUI window from any agent window —
with the default tmux prefix that's **`ctrl-b` then `Space`** (installed by
`holo` / `holo setup`; note: tmux bindings are server-global).

## Sidebar keys (the 30-col pane beside each agent — only when tmux-focused)

| Key | Action |
|---|---|
| `j/k` (or arrows) | navigate the queue |
| `enter` | jump to the selected session's window |
| `a` / `d` | approve / deny a pending permission on the selected item |
| `q` | close the sidebar pane (the window and agent are unaffected) |

The sidebar receives keys only when you deliberately tmux-focus it; while you
type in the agent pane it stays read-only.

**Tips:**
- **`prefix+z` zooms the agent pane fullscreen** (press again to restore) — use
  it when you want the whole window for the agent, instead of killing the
  sidebar.
- **Kill an agent session with `prefix+&` (the whole window) or by exiting the
  agent — never `prefix+x` on the agent pane.** A pane-kill bypasses the
  `pane-died` death trap and strands the window sidebar-only; the session then
  goes stale until you close the window. If the terminal is resized below 111
  cols both panes get squeezed — zoom with `prefix+z` or close the sidebar
  with `q`.

## CLI

```text
holo                 attach/start tmux session + TUI (starts daemon if needed)
holo new <harness> [--cwd <path>]
holo next            jump to top queue item (scriptable / tmux-bindable)
holo ls              session list, plain text
holo setup           install tmux binding, report harness configuration
```

Internal subcommands: `holo tui` (window-0 process), `holo daemon` (foreground
daemon, for debugging), `holo sidebar` (the per-agent-window board pane, spawned
by holod). The spec's `holo hook` is intentionally not a subcommand — injected
hooks invoke `src/hook/main.ts` directly so the hot path skips CLI dispatch.

## Development

```bash
bun run test        # vitest under bun (required: locked @opentui/core needs bun:ffi)
bun run typecheck   # tsc --noEmit (test files excluded, per tsconfig)
HOLO_HOME=$(mktemp -d) bun src/index.tsx ls   # sandboxed manual poke
```

The `fake` harness is the dogfood/test agent: `holo new fake` spawns
`src/adapters/fake-agent.ts`, which emits a scripted lifecycle
(ready → prompt → tool → stop). Set `HOLO_FAKE_SCRIPT` to a JSON step array
(`{delayMs, event}` / `{delayMs, permission: {tool, input}}`) to script custom
flows, including held permissions.

Code rules: `node:*` APIs only (vitest compatibility), TypeScript strict,
single quotes + semicolons, named exports. The daemon, registry, scoring, and
adapters are all dependency-injected and covered by the fast suite — tmux is
faked, no real agent binaries are touched by tests.

## Deviations from spec.md (v1)

- Codex gets **remote permission approval too** — codex-cli 0.137 ships a
  hooks system with `PermissionRequest` (the spec predicted degradation to
  needs_input). Codex's `notify` config is left untouched.
- `holo hook` CLI subcommand omitted (see above).
- The tmux return binding is server-global — tmux can't scope bindings to a
  session.
- New sessions start as `idle` / "awaiting first prompt" — they are actionable
  (you owe them a prompt), so they queue at idle weight.
