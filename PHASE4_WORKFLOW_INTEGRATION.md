# Phase 4: Workflow Integration

Connect the session system to the rest of the app — permissions, task status, history, and cost. Phases 1-3 build the engine; this phase wires it into the dashboard.

## Phase 1 Findings

These details were discovered during Phase 1 implementation and affect Phase 4:

- **Permission mode names in the implementation are `'default' | 'safe-auto' | 'bypass'`**, matching SDK terminology. The user-facing names below (Interactive / Safe Auto / Full Auto) are display labels — map them to these internal values.
- **`model`, `permissionMode`, and `sdkSessionId` are already on the sessions schema** (added in Phase 1). Only `costUsd`, `tokenUsage`, and `duration` need to be added.
- **`costUsd` and `tokenUsage` can be extracted from the SDK `result` event.** Phase 1 already detects `event.type === 'result'` for error status — extend this to also capture `total_cost_usd` and token usage fields.
- **Unauthenticated Convex mutations must be converted to `internalMutation` before adding more.** Phase 1 added `insertBatch`, `updateSdkSessionId`, and `serverUpdateStatus` as public mutations with no auth (flagged by Greptile and security review). Fix this pattern before Phase 4 adds more server-side mutations (cost updates, status transitions).
- **Safe-auto Bash allowlisting is already restrictive.** Phase 1 implemented specific subcommand patterns (`bun test`, `bun run lint`, `bun run check`, etc.) plus shell operator rejection (`;&|`$\n<>`). The "Custom Profiles (Future)" section is partially done.

## Phase 2 Findings

These details were discovered during Phase 2 implementation and affect Phase 4:

- **Session replay infrastructure is already in place.** Phase 2 implemented `sessionEvents` persistence to Convex and `useQuery(api.sessionEvents.getBySession)` to load full event history on reconnect. `MessageStream` accepts a plain `events: SDKMessage[]` array with no dependency on a live WebSocket — rendering a past session is just passing stored events to the same component. Phase 4's "session history replay" section can be built by reusing this pattern directly.
- **Model picker is already implemented.** `ClaudeButton` + `ModelPicker` (Phase 2) handle model selection at launch time, including reset-on-task-switch and the `DEFAULT_MODEL` fallback. Phase 4's launch UI only needs to add the **permission profile** selector and **resume** option to the existing dialog — the model picker is done.
- **Cost/token capture from the SDK `result` event still needs to be done.** Phase 2 extended the `result` event handling for error status but did not capture `total_cost_usd` or token usage. The extraction point is `manager.ts` where `event.type === 'result'` is already detected — extend it to call a Convex mutation to store cost/token data on the session record.
- **`internalMutation` conversion is still pending.** Phase 1 added `insertBatch`, `updateSdkSessionId`, and `serverUpdateStatus` as public unauthenticated mutations. Phase 2 added `serverUpdateStatus` calls for idle/queued states. None of these have been converted to `internalMutation` yet. This must be done before Phase 4 adds more server-side mutations for cost and status transitions.
- **`sessions.get` query was added in Phase 2** (`convex/sessions.ts`). Phase 4's session history UI can use this to check session existence before rendering stored events.

## Permission Profiles

The `canUseTool` callback in Phase 1 is powerful but raw — it needs a user-facing configuration layer. Permission profiles are presets that determine which tools get auto-approved and which require human intervention.

Three presets:

**Interactive** (`default`) — everything prompts. Equivalent to the current terminal experience where you type y/n for each action. Best for sensitive work or unfamiliar codebases where you want to see every move Claude makes.

**Safe Auto** (`safe-auto`) — read-only tools (Read, Glob, Grep, WebSearch, WebFetch, TodoRead) are auto-approved. Bash is auto-approved only for specific safe commands (`bun test`, `bun run lint`, `git status`, `ls`, etc.) with shell operator rejection. All other write operations require approval. This is the sweet spot for most work: Claude can explore freely but you sign off on changes. Most sessions should use this.

**Full Auto** (`bypass`) — all tools auto-approved. Claude runs completely autonomously. Best for well-scoped tasks with clear prompts where you trust the outcome, like "run the test suite and fix any failures" or "update all imports to use the new path alias." Review the diff after, not during.

### Where Profiles Live

Profiles are configured at two levels:

- **Per-repo default**: stored on the repo record in Convex. "For this repo, default to Safe Auto." Applies to all tasks in the repo unless overridden.
- **Per-task override**: set at launch time in the session start dialog. "For this specific task, use Full Auto." Overrides the repo default.

The launch UI shows a dropdown or segmented control: Interactive / Safe Auto / Full Auto. Pre-selected to the repo default. The user can change it before launching.

### Custom Profiles (Future)

Down the road, users might want fine-grained control beyond the three presets. Phase 1 already implements the core mechanism: `SAFE_BASH_PATTERNS` (regex allowlist for specific commands) and `SAFE_TOOLS` (set of always-approved tool names) in `src/claude/manager.ts`. A custom profile would expose these as user-configurable lists rather than hardcoded constants. Not needed for dogfooding — the three presets cover the common cases.

## Auto-Status Transitions

The kanban board should reflect what's actually happening. Right now, launching Claude doesn't move the task — you manually drag it to "In Progress." The status should follow the session lifecycle:

- **Session starts** → task moves to `in_progress` (if it was in `todo` or `backlog`)
- **Session completes** → task moves to `review` (Claude finished, human should check the result)
- **Session fails** → task stays in `in_progress` (needs attention, not done)
- **Session stopped** → no change (user intentionally stopped, they'll decide where it goes)

These transitions should be automatic but not surprising. A small visual indicator on the task card (a brief animation or status change toast) helps the user understand why a card moved.

### Opt-Out

Some users might not want auto-transitions — they manage their board manually and the auto-moves would be disruptive. A per-repo setting: "Auto-update task status on session events" (default: on). Stored on the repo record in Convex alongside the default permission profile.

### Edge Cases

- Task is already in `review` or `done` when session starts → don't move it backwards to `in_progress`. Only transition forward.
- Multiple sessions on the same task → status follows the most recent session event. If one session completes but another is still running, keep at `in_progress`.
- Task was manually moved to `done` while session is running → respect the manual override, don't revert.

The rule: auto-transitions only move tasks forward in the workflow (backlog → todo → in_progress → review → done), never backward. Manual moves always take precedence.

## Session History

Every task should have a record of its Claude sessions — what was asked, what happened, how long it took, what it cost. This lives in the task detail panel as a collapsible section.

### What the History Shows

A list of past sessions, most recent first. Each entry shows:

- **Timestamp** — when the session started
- **Duration** — how long it ran
- **Model** — which Claude model was used
- **Status** — completed / failed / stopped
- **Cost** — total cost from the SDK's result event (or token count if cost isn't available)
- **Prompt** — the initial prompt (truncated, expandable)

Clicking a session entry expands it to show the full event log — the same MessageStream component from Phase 2, but rendering stored events from Convex instead of a live WebSocket stream. This is session replay.

### Session Replay

The stored `sessionEvents` from Phase 1 make this possible. Fetching all event batches for a session and rendering them through the same MessageStream component gives you a read-only replay of the entire session. You can see everything Claude did, every tool it called, every permission you granted, and the final result.

This is one of the biggest upgrades over the terminal approach — with PTY, once you close the terminal, the output is gone. With the SDK + Convex persistence, every session is permanently reviewable.

### Cost Data

The SDK's `result` event includes `total_cost_usd` and a token usage breakdown (input, output, cache read, cache creation tokens). This data is stored with the session record in Convex.

Display cost at two levels:

- **Per-session**: shown in the session history entry
- **Per-task**: sum of all sessions for that task, shown in the task detail panel header

This gives you a sense of how expensive a task has been across iterations. "This auth refactor has cost $2.40 across 5 sessions" is useful information for deciding whether to keep iterating or take a different approach.

### Aggregate Views (Future)

Per-repo and per-day cost aggregates would be useful for budget awareness, but they're not needed for dogfooding. The per-task rollup is enough to start.

## Launch UI Changes

The session launch flow (currently the "Launch Claude Code" button in the task detail panel) gets a few additions:

- **Model picker**: dropdown with Opus 4.6 / Sonnet 4.5 / Haiku 4.5
- **Permission profile**: dropdown or segmented control with Interactive / Safe Auto / Full Auto
- **Resume option**: if the task has a previous session, offer "Resume last session" as an alternative to starting fresh

These controls should have sensible defaults (repo's default model and permission profile) so you can still launch with a single click for the common case. The additional options are there when you need them, not in your face when you don't.

## Convex Schema Changes

The `sessions` table already has these fields from Phase 1:

```
model: v.optional(v.string())           // already added
permissionMode: v.optional(v.string())  // already added (not 'permissionProfile')
sdkSessionId: v.optional(v.string())    // already added
```

New fields needed for Phase 4:

```
costUsd: v.optional(v.number())        // from SDK result event
tokenUsage: v.optional(v.object({
  inputTokens: v.number(),
  outputTokens: v.number(),
  cacheReadTokens: v.optional(v.number()),
  cacheCreationTokens: v.optional(v.number()),
}))
duration: v.optional(v.number())       // ms, computed from startedAt to endedAt
```

**Important**: The server-side mutations that update these fields (`updateSdkSessionId`, `serverUpdateStatus`, `insertBatch`) are currently public unauthenticated mutations. Before adding more server-side mutations for cost/token updates, convert the existing ones to `internalMutation` (callable only from Convex actions, not from external clients). Use a Convex HTTP action with a shared secret for the `ConvexHttpClient` calls from the Bun server.

The `repos` table gets:

```
defaultModel: v.optional(v.string())
defaultPermissionProfile: v.optional(v.string())
autoStatusTransitions: v.optional(v.boolean())  // default true
```

## Done When

- Permission profile selector works in the launch UI and flows through to `canUseTool` behavior
- Task status auto-updates on session start (→ in_progress) and completion (→ review)
- Session history section in task detail panel shows past sessions with timestamp, duration, model, cost, status
- Clicking a session history entry shows the full event replay
- Cost displays per-session and per-task
- Model and permission profile defaults are configurable per-repo
- Resume option works for continuing previous sessions
