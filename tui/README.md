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
- **Queue scoring**: permission 100, needs_input 60, error 50, idle 30, plus
  +2/min waiting (capped +40). Quick wins first; no panic UI.

## TUI keys (window 0 only — zero key capture inside agent windows)

| Key | Action |
|---|---|
| `j/k` (or arrows) | navigate queue/sessions |
| `enter` | jump to session's tmux window |
| `n` | new session (harness picker → fuzzy cwd picker) |
| `a` / `d` | approve / deny pending permission on selected item |
| `tab` | toggle focus sessions ↔ queue |
| `q` | quit TUI (daemon + sessions keep running) |

`prefix+Space` in tmux returns to the TUI window from any agent window
(installed by `holo` / `holo setup`; note: tmux bindings are server-global).

## CLI

```text
holo                 attach/start tmux session + TUI (starts daemon if needed)
holo new <harness> [--cwd <path>]
holo next            jump to top queue item (scriptable / tmux-bindable)
holo ls              session list, plain text
holo setup           install tmux binding, report harness configuration
```

Internal subcommands: `holo tui` (window-0 process), `holo daemon` (foreground
daemon, for debugging). The spec's `holo hook` is intentionally not a
subcommand — injected hooks invoke `src/hook/main.ts` directly so the hot path
skips CLI dispatch.

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
