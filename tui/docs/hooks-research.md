# Verified hook capabilities (2026-06-09)

Research distilled from official docs + local CLI verification. Versions:
Claude Code **2.1.170**, codex-cli **0.137.0**, tmux 3.6b, bun 1.3.14.
This is the ground truth the adapters are built against — re-verify before
changing adapter behavior.

## Claude Code

### Hook events used by holo

All hooks receive one JSON object on **stdin**. Common fields:
`session_id`, `transcript_path`, `cwd`, `hook_event_name` (+ `permission_mode`
and `tool_use_id` on tool events).

| Hook | Extra input fields | holo mapping |
|---|---|---|
| `SessionStart` | `source: startup\|resume\|clear\|compact`, `model` | `ready` |
| `UserPromptSubmit` | `prompt` | `prompt` |
| `PreToolUse` | `tool_name`, `tool_input` | `AskUserQuestion` → `question` (text = `tool_input.questions[0].question`); else `tool` |
| `Notification` | `notification_type`, `message` | `permission_prompt` / `idle_prompt` → `notification` (reason = message); ignore other types (`auth_success`, elicitation ones) |
| `Stop` | `effort` — does **NOT** carry the last message | `stop`; read lastMessage from the tail of `transcript_path` |
| `SessionEnd` | `reason: clear\|resume\|logout\|prompt_input_exit\|bypass_permissions_disabled\|other` | `exit`. May not fire on hard SIGINT — daemon liveness sweep is the backstop |
| `PermissionRequest` | `tool_name`, `tool_input`, `tool_use_id` | held synchronous flow (below) |

### PermissionRequest (synchronous remote approval)

Blocking: the permission dialog does not appear until the hook process exits.

- Approve/deny — exit 0 with stdout JSON:
  ```json
  {"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}
  ```
  (`"deny"` to deny.)
- **Exit 0 with no output → falls through to the normal permission dialog in
  the pane** (and `Notification(permission_prompt)` then fires). This is the
  degradation path for daemon-down and remote-decision-timeout.
- Default hook timeout 600s; configurable per hook entry via `"timeout"`
  (seconds). holo sets it above the daemon's hold deadline.

### AskUserQuestion

Fires PreToolUse, requires no permission. `tool_input.questions[]`:
`{ question, header, options: [{label}], multiSelect }`.

### Spawn-time injection

- `claude --settings <file-or-json>` — merges ABOVE user/project/local
  settings (only managed settings outrank it). Hooks injectable this way.
- `claude --session-id <uuid>` — must be a valid UUID; holo generates one
  per session (`Session.harnessSessionId`).
- `"preferredNotifChannel": "notifications_disabled"` is valid — kills OS
  notifications so hooks are the single signal source.

## Codex CLI 0.137.0

### Hooks (preferred — do NOT use `notify`)

Hooks are stable + enabled by default (`codex features list`). Supported:
`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`,
`PostToolUse`, `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`,
`Stop`. **No SessionEnd, no Notification** — session end is detected by the
daemon's tmux liveness sweep.

Per-invocation injection (live-verified against codex **0.139**; dead in
0.137 — see LIVE-TEST RESULTS below; holo requires codex ≥ 0.139):

```bash
codex -C <cwd> \
  -c 'hooks.UserPromptSubmit=[{hooks=[{type="command",command="<cmd>"}]}]' \
  -c 'hooks.PreToolUse=[{hooks=[{type="command",command="<cmd>"}]}]' \
  -c 'hooks.PermissionRequest=[{hooks=[{type="command",command="<cmd>",timeout=150}]}]' \
  -c 'hooks.Stop=[{hooks=[{type="command",command="<cmd>"}]}]' \
  -c 'hooks.SessionStart=[{hooks=[{type="command",command="<cmd>"}]}]' \
  --dangerously-bypass-hook-trust
```

- Each `-c` value must parse as TOML (`key=value`); pass as ONE argv element.
- `--dangerously-bypass-hook-trust` is required: non-managed injected hooks
  are otherwise skipped until interactively trusted via `/hooks`.
- `-c` overrides are in-memory only (never written to `~/.codex/config.toml`)
  and hook layers MERGE with file-based config.

Hook stdin JSON common fields: `session_id`, `cwd`, `hook_event_name`,
`model`, `transcript_path` (nullable), `permission_mode`; turn-scoped events
add `turn_id`. Notable per-event fields:

- `UserPromptSubmit`: `prompt`
- `Stop`: `last_assistant_message` (nullable) — carried directly, unlike Claude
- `PermissionRequest`: `tool_name` (`Bash`, `apply_patch`, `mcp__*`),
  `tool_input` (e.g. `tool_input.command`); same decision output shape as
  Claude; exit 0 with no output → normal pane approval prompt proceeds.

### LIVE-TEST RESULTS (2026-06-10, codex 0.137.0 installed via brew)

- **`-c hooks.X=[...]` (SessionFlags) injection does NOT fire in 0.137.0** —
  tested live with both dotted-key and whole-table forms, exec and interactive.
  The engine's discovery lists SessionFlags as a hook source, but no hooks
  dispatch from it in this release. The adapter's current argv is correct per
  docs but dead against 0.137.
- **File-based hooks DO fire** (verified live: `~/.codex/hooks.json` +
  `--dangerously-bypass-hook-trust`, interactive TUI) — SessionStart and
  UserPromptSubmit payloads match the schemas above exactly.
- `codex exec` did not fire hooks at all in 0.137 (interactive only).
- **Update prompt blocks session startup**: codex showed a 0.137→0.139
  updater dialog before the session UI; spawn argv should include
  `-c check_for_update_on_startup=false`.
### LIVE-TEST RESULTS (2026-06-10, codex 0.139.0 via `bunx @openai/codex@0.139.0`)

- **`-c hooks.X=[...]` injection WORKS in 0.139 interactive mode** — marker
  test in an isolated `tmux -L` server fired SessionStart, UserPromptSubmit,
  and Stop hooks with the exact argv shape the adapter builds (dotted-key
  `-c` overrides + `--dangerously-bypass-hook-trust`). The 0.137 failure is
  a fixed upstream bug, not an adapter defect.
- `codex exec` still fires no hooks in 0.139 — irrelevant for holo (always
  spawns the interactive TUI in tmux).
- Decision: keep the `-c` injection adapter, **require codex ≥ 0.139**, and
  pass `-c check_for_update_on_startup=false` (the update dialog otherwise
  blocks session startup). The brew install (0.137) was NOT upgraded — Codex
  Computer Use depends on it; surface the upgrade to Ko separately.

### Why not `notify`

`notify` fires `agent-turn-complete` only, and a per-invocation
`-c notify=[...]` would REPLACE Ko's global notify (claimed by Codex Computer
Use's SkyComputerUseClient) for that session. Hooks cover everything notify
does and more, so holo leaves `notify` alone entirely.

### Other codex facts

- No `--session-id` equivalent — codex generates a UUIDv7; capture it from
  the `SessionStart` hook payload (`session_id`) if needed for `codex resume`.
- `-C <dir>` sets the working root; appears as `cwd` in every hook payload.
- The TUI process stays alive between turns: one process = one session.
  Process/window exit = session end.

## tmux notes

- `bind-key` is server-global — tmux cannot scope a binding to one session.
  holo installs `prefix+Space → select-window -t holo:tui` globally.
- `new-window -P -F '#{window_id}'` prints the stable window id (`@N`).
