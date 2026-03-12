# Research: Orchestrator Features & YOLO Mode

## Context

Research into how Holophyte should evolve from a session launcher into a full orchestration platform. Investigated existing tools (Traycer.ai, ComposioHQ, Overstory, LangGraph, etc.) and synthesized a phased plan.

## Competitive Landscape

### Traycer.ai (Key Reference)

Traycer is an "outer-loop agent" — it plans, orchestrates, and verifies but doesn't write code. Delegates execution to Claude Code, Cursor, or Windsurf.

**Architecture:**
1. **Groundwork** — Sonnet plans, Grok scouts fan out in parallel to gather file context
2. **Task Decomposition** — Objectives → ordered, PR-sized "Phases" on a kanban board
3. **Agent Handoff** — Structured prompts with file lists/constraints → coding agent
4. **Verification** — GPT reviews diffs against acceptance criteria (AST + dependency graph + Docker runtime)

**Multi-model ensemble:**

| Stage | Model | Purpose |
|---|---|---|
| Planning & decomposition | Sonnet 4.5 | Deep reasoning |
| Context gathering (scouts) | Grok 4.1-fast | Parallel fan-out, fast |
| Verification & debugging | GPT 5.1 | Diff review against acceptance criteria |
| Summarization | GPT 5.1-mini | Condensing large context |

**Notable features:**
- Spec-driven development (plan before code)
- Smart YOLO (autonomous plan→code→test→verify loop)
- Epic Mode (Epics → Tickets → Phases hierarchy)
- Input/output contracts between phases for safe parallelism
- Three-layer verification: AST parsing, dependency graph simulation, runtime checks

**Limitations:** No git worktree management, no real-time streaming to browser, VS Code extension only, closed source, $10-40/user/mo.

### Other Tools Evaluated

- **ComposioHQ SWE Agent:** Python, CI-in-the-loop concept is good
- **Overstory AI:** Competing product (kanban + Claude Code), not a library
- **LangGraph:** Pulls in entire LangChain ecosystem, JS support is second-class
- **Swarms/CrewAI:** Python-only multi-agent frameworks
- **ts-dag/dagraph:** Just data structures, no execution engine

**Conclusion:** No off-the-shelf library fits. The DAG logic needed is ~50 lines on top of Convex.

## Feature Design

### Task Dependencies (DAG)

Add `dependsOn` field to tasks. When a task completes, check if any dependent tasks have all their dependencies satisfied and auto-advance them.

**Schema change:**
```typescript
// convex/schema.ts - tasks table
dependsOn: v.optional(v.array(v.id('tasks'))),
```

**Mutations needed:**
- `addDependency(taskId, dependsOnId)` — validate no cycles via DFS topo sort
- `removeDependency(taskId, dependsOnId)`
- `onTaskComplete(taskId)` — find dependents, check if all deps met, auto-start

Convex reactivity handles real-time UI updates for free.

### Auto Worktree-Per-Task

Each Claude Code session gets an isolated git worktree. Prevents file conflicts when running parallel sessions on the same repo.

- `worktree:setup` script configures a repo for worktree-based development
- Session start creates worktree, session end cleans up (or preserves for review)
- Worktree branch naming: `task/<taskId-short>/<task-slug>`

### Auto-Status Transitions

Session lifecycle drives kanban status automatically:
- Session started → task moves to **In Progress**
- Session completed → task moves to **Review**
- PR merged → task moves to **Done** → dependent tasks auto-advance

### YOLO Mode

A policy toggle per-task (or per-epic) that controls the automation level after a Claude Code session completes.

#### Two Modes

**Manual YOLO:**
```
Session completes
  → PR created automatically
  → Review bots run (CodeRabbit, Greptile, GitHub Actions)
  → Comment handler agent auto-addresses comments
  → User reviews & merges PR
  → Task marked Done → dependent tasks auto-start
```

**Auto YOLO:**
```
Session completes
  → PR created automatically
  → Review bots run (CodeRabbit, Greptile, GitHub Actions)
  → Comment handler agent auto-addresses comments
  → CI green + no unresolved comments → auto-merge
  → Task marked Done → dependent tasks auto-start
```

Both modes share the same automation pipeline. The only difference is the final gate: manual waits for user merge, auto checks CI + zero unresolved comments and merges itself.

**Mockup — YOLO pipeline state machine:**
```
                          ┌──────────────────────────────────────────────────┐
                          │              YOLO Pipeline                       │
                          │                                                  │
  ┌─────────┐   start     │  ┌─────────┐  done   ┌──────────┐  pass        │
  │  Idle   │────────────►│  │ Session │────────►│ Verify   │─────────┐    │
  └─────────┘             │  │ Running │         │ (test/   │         │    │
                          │  └─────────┘         │  lint/   │         │    │
                          │       ▲              │  types)  │         │    │
                          │       │ retry        └──────────┘         │    │
                          │       │                   │ fail          │    │
                          │       │                   ▼              ▼    │
                          │       │              ┌──────────┐  ┌────────┐ │
                          │       └──────────────│ Auto-Fix │  │ Create │ │
                          │         (max 2)      └──────────┘  │   PR   │ │
                          │                                     └────────┘ │
                          │                                         │      │
                          │                          ┌──────────────┘      │
                          │                          ▼                     │
                          │                    ┌───────────┐               │
                          │                    │ CI + Bots │               │
                          │                    │  Running   │               │
                          │                    └───────────┘               │
                          │                     │          │               │
                          │              comments?    all clear            │
                          │                     ▼          │               │
                          │              ┌───────────┐     │               │
                          │              │  Comment  │     │               │
                          │              │  Handler  │◄────┘               │
                          │              │           │  (loop)             │
                          │              └───────────┘                     │
                          │               │         │                      │
                          │          unresolved   all resolved             │
                          │               │         │                      │
                          │               ▼         ▼                      │
                          │  ┌──────────────┐  ┌──────────────┐           │
                          │  │ Await User   │  │  Gate Check  │           │
                          │  │ (always for  │  │              │           │
                          │  │  Manual)     │  │  Auto: merge │           │
                          │  └──────┬───────┘  │  Manual: wait│           │
                          │         │          └──────┬───────┘           │
                          │         │ merge           │ merge             │
                          │         ▼                 ▼                   │
                          │       ┌─────────────────────┐                 │
                          │       │       Done          │                 │
                          │       │  ► start dependents │                 │
                          │       └─────────────────────┘                 │
                          │              │          │                      │
                          │         (if failure detected downstream)       │
                          │              ▼                                 │
                          │       ┌─────────────┐                         │
                          │       │  Rollback   │                         │
                          │       │ git revert  │                         │
                          │       │ pause deps  │                         │
                          │       └─────────────┘                         │
                          └──────────────────────────────────────────────────┘
```

#### PR Comment Handler

An automated loop that processes PR review comments:

1. **Poll** PR for new comments (CodeRabbit, Greptile, human reviewers)
2. **Classify** each comment:
   - Fixable bug / code issue
   - Style nit / suggestion
   - False positive / irrelevant
   - Question / clarification request
3. **Act** based on classification:
   - **Bug/fix** → push a new commit addressing the issue
   - **Question** → reply with explanation from codebase context
   - **False positive/nit** → resolve with brief justification
   - **Suggestion** → apply if aligned with task goals, otherwise explain why not
4. **Loop** until no unresolved comments remain
5. **Gate check** (Auto YOLO only): CI green + zero unresolved → auto-merge

This is essentially the existing `/review-pr-comments` skill automated as a pipeline step rather than manual invocation.

#### Epic-Level YOLO

When YOLO is set on an epic (parent task), the entire dependency chain executes autonomously:

```
Epic starts
  → Phase 1 tasks start (no deps)
  → Each completes → PR → review → merge → advance
  → Phase 2 tasks auto-start (deps satisfied)
  → ... continues until all phases complete
  → Epic marked Done
```

Smart YOLO detects independent tasks and runs them in parallel. Dependent tasks wait.

### DAG Visualization

Interactive node/edge graph showing task dependencies with real-time status propagation.

**Mockup:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Epic: "User Authentication"                          View: Graph │ List   │
│  4/7 tasks done · 2 running · 1 blocked               YOLO: Auto ▾       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────────┐                                                         │
│   │ ✅ Schema    │                                                          │
│   │ migration    │──────────┐                                              │
│   │ $0.34        │          │                                              │
│   └──────────────┘          │                                              │
│          │                  │                                               │
│          ▼                  ▼                                               │
│   ┌──────────────┐   ┌──────────────┐                                      │
│   │ ✅ Auth      │   │ ✅ Password  │                                       │
│   │ middleware   │   │ hashing util │                                       │
│   │  $0.22       │   │  $0.09       │                                      │
│   └──────────────┘   └──────────────┘                                      │
│          │                  │                                               │
│          ▼                  │                                               │
│   ┌──────────────┐         │                                               │
│   │ 🔄 Login     │◄────────┘                                               │
│   │ endpoint     │──────────┐                                              │
│   │ ● Running... │          │                                              │
│   └──────────────┘          │                                              │
│          │                  │                                               │
│          ▼                  ▼                                               │
│   ┌──────────────┐   ┌──────────────┐                                      │
│   │ 🔄 Session   │   │ ⏸ Protected  │                                      │
│   │ management   │   │ routes       │                                       │
│   │ ● Running... │   │ Waiting: 2   │◄─── blocked on Login + Session       │
│   └──────────────┘   └──────────────┘                                      │
│          │                  │                                               │
│          └──────┬───────────┘                                               │
│                 ▼                                                            │
│          ┌──────────────┐                                                   │
│          │ ○ E2E tests  │                                                   │
│          │ Waiting: 2   │                                                   │
│          │ ~$0.41 est.  │                                                   │
│          └──────────────┘                                                   │
│                                                                             │
│  Legend: ✅ Done  🔄 Running  ⏸ Blocked  ○ Pending  🔴 Failed              │
│  Cost: $0.65 spent · ~$0.68 estimated remaining                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Sub-Tasks with Auto-Close

Parent tasks complete automatically when all children complete. Enables epic-style grouping where an epic is just a parent task with sub-tasks as phases.

### Post-Session Verification

Before PR creation, auto-run quality checks:
- `bun run test` — unit tests
- `bun run lint` — Biome lint
- TypeScript typecheck
- Custom verification scripts (configurable per-repo)

Results attached to the task. If verification fails, the session can auto-retry (push a fix commit) or pause for user review.

### Pre-Execution Planning

Before handing a prompt to Claude Code, generate a structured spec:
- Files to modify (with specific functions/classes)
- Expected changes per file
- Acceptance criteria
- Test expectations

This is Traycer's key insight — plans are reviewable artifacts that catch issues before code is written.

## Phased Implementation Plan

### Phase 1 — Foundation (Solo Dev Essentials)

1. **Task dependencies** — `dependsOn` field, cycle detection, auto-advance when deps met
2. **Auto worktree-per-task** — isolated worktree per session, cleanup on completion
3. **Auto-status transitions** — session lifecycle → kanban status changes
4. **Sub-tasks with auto-close** — parent completes when all children complete

### Phase 2 — Verification & Intelligence

5. **Post-session verification** — auto-run tests/lint/typecheck, results on task
6. **Pre-execution planning** — structured spec generation before Claude Code handoff
7. **PR comment handler** — auto-classify and address review comments

### Phase 3 — Full Orchestration (YOLO)

8. **YOLO mode (Manual)** — auto-PR + auto-address comments, user merges
9. **YOLO mode (Auto)** — auto-merge when CI green + no unresolved comments
10. **Epic-level YOLO** — autonomous execution across dependency chains
11. **DAG visualization** — interactive node/edge view with real-time status

### Phase 4 — Advanced

12. **Multi-model routing** — different models for different task types
13. **Context preservation** — pause/resume sessions without re-explaining
14. **MCP companion agent** — task CRUD, ideation, prompt help via chat

### Session Replay (Interactive Timeline)

Store the full Claude Code event stream (already streamed via WebSocket) as a persistent, replayable artifact on each task.

**UI: seekable timeline scrubber**
- Horizontal timeline bar showing session duration
- Event markers: tool calls, file edits, approvals, errors — each a clickable point on the timeline
- Playback controls: play/pause, speed (1x/2x/4x), skip to next event
- Event filtering: toggle visibility by type (tool calls, file reads, edits, shell commands, conversation)
- Split view: left panel shows the conversation/event at the current position, right panel shows the file diff at that point in time
- Scrub to any point to see the full state: which files were open, what the agent was thinking, what tool it called

**Mockup:**
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Session Replay — "Add user auth endpoint"          Session #3  ⏱ 4m 32s  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ◀◀  ▶  ▶▶   1x ▾   ──●───────────────────────────────────────── 1:23/4:32│
│                        ▲     ▲  ▲▲    ▲         ▲   ▲▲  ▲                  │
│                        │     │  ││    │         │   ││  │                   │
│                      Read  Edit ││  Shell     Read  ││ Approve              │
│                                 ││                  ││                      │
│  Filter: [x] Tool calls  [x] Edits  [ ] Reads  [x] Shell  [x] Messages    │
│                                                                             │
├──────────────────────────────────┬──────────────────────────────────────────┤
│  Conversation                    │  File Diff                              │
│                                  │                                         │
│  ┌─ Agent ─────────────────────┐ │  src/server.ts                          │
│  │ I'll add the auth endpoint  │ │  ┌────────────────────────────────────┐ │
│  │ to server.ts. Let me read   │ │  │  @@ -45,6 +45,18 @@               │ │
│  │ the current routes first.   │ │  │    '/api/config': () => ...        │ │
│  └─────────────────────────────┘ │  │  + '/api/auth/login': async (r) =>│ │
│                                  │  │  +   const { email, pass } = ...   │ │
│  ┌─ Tool: Read ────────────────┐ │  │  +   const user = await db...     │ │
│  │ src/server.ts (245 lines)   │ │  │  +   return Response.json({...    │ │
│  └─────────────────────────────┘ │  │  + },                             │ │
│                                  │  └────────────────────────────────────┘ │
│  ┌─ Agent ─────────────────────┐ │                                         │
│  │ I see the route pattern.    │ │  Files changed at this point: 1        │
│  │ Adding POST /api/auth/login │ │  +18 -0 lines                          │
│  └─────────────────────────────┘ │                                         │
│                                  │                                         │
│  ┌─ Tool: Edit ───── ● NOW ───┐ │                                         │
│  │ src/server.ts:45            │ │                                         │
│  │ Added auth route handler    │ │                                         │
│  └─────────────────────────────┘ │                                         │
│                                  │                                         │
└──────────────────────────────────┴──────────────────────────────────────────┘
```

**Data model:**
```typescript
// convex/schema.ts - sessions table addition
events: v.optional(v.array(v.object({
  timestamp: v.number(),
  type: v.string(),       // 'tool_call' | 'tool_result' | 'message' | 'approval' | 'error'
  data: v.any(),          // event payload
}))),
```

**Pre-compaction log preservation:**

Claude Code auto-compacts conversation history as sessions approach context limits. The compacted summary is what the agent works from, but the original uncompacted events are far more valuable for replay and debugging. Store the full pre-compaction event stream alongside the compacted version:

- **Full log** — every event as-received from the SDK, stored in order. This is the replay source of truth.
- **Compacted log** — the summarized version Claude actually saw. Shown inline in the timeline by default.
- **UI toggle** — "Show full history" expands compacted regions to reveal the original events that were summarized away. Collapsed by default to keep the timeline readable, but one click expands any compacted section.

This is cheap to implement since we already stream all SDK events via WebSocket — just persist them to Convex before any compaction happens. The compaction boundaries become visible markers on the timeline (e.g., "Events 47-182 compacted into summary").

```typescript
// convex/schema.ts - sessions table
events: v.optional(v.array(v.object({
  timestamp: v.number(),
  type: v.string(),
  data: v.any(),
  compacted: v.optional(v.boolean()),  // true if this event was part of a compacted range
  compactionId: v.optional(v.string()), // groups events that were compacted together
}))),
```

**Use cases:**
- Debug failed sessions — scrub to the point of failure, expand compacted regions to see what happened
- Learn what prompts/approaches work best
- Share session replays with teammates for review
- Audit trail for auto-YOLO runs
- Post-mortem analysis — see exactly what context the agent lost during compaction and whether that caused a mistake

### Rollback Chains

When a YOLO task fails verification or breaks a dependent downstream task, automatically revert and pause:

1. **Detection** — post-session verification fails, CI fails, or a dependent task reports breakage
2. **Revert** — `git revert` the merged PR, creating a clean revert commit
3. **Pause** — mark the task as "failed", pause all downstream dependents
4. **Notify** — surface the failure reason in the task card with a link to the revert PR
5. **Re-queue** — user can fix the prompt/approach and re-run, or manually intervene

This makes Auto YOLO safe to run unattended — failures are contained, not cascading.

### Session Cost Tracking

Show the dollar cost of each session directly in the UI. More intuitive than raw token counts — nobody thinks in tokens, everyone thinks in money.

**Per-session cost display:**
- During execution: show running cost in session panel (e.g., "$0.47 so far")
- After execution: store final cost on the session record
- Task-level rollup: sum of all session costs for that task

**Cost visibility (not budgets):**
- Session cost shown on task detail panel and session list
- Per-task cumulative cost visible on kanban cards
- Daily/weekly cost summaries in settings (future)
- No per-task budget enforcement — cost is informational, not a hard limit

**Schema:**
```typescript
// convex/schema.ts - sessions table addition
costUsd: v.optional(v.number()),  // total session cost in USD
```

### Merge Queue Integration

For repos with GitHub merge queues enabled, Auto YOLO should add PRs to the merge queue rather than direct-merging:
- Respects branch protection rules
- Handles rebase conflicts between parallel PRs automatically
- Falls back to direct merge if no merge queue is configured

### Prompt Templates (Future — Needs Separate Design)

The current template system is inadequate and should be replaced. Deferred to a separate design doc. Key requirements to explore:
- Per-repo template directories (`.holophyte/templates/`)
- Template variables filled from task context
- Template composition (base + override)
- Template marketplace / sharing

## UI Mockups

### Task Detail Panel (Updated)

Shows the new orchestration fields integrated into the existing task detail view.

```
┌─────────────────────────────────────────┐
│  ← Back                     ⋯  🗑       │
├─────────────────────────────────────────┤
│                                         │
│  Add user login endpoint                │
│  ─────────────────────────────────────  │
│                                         │
│  Status: In Progress ▾                  │
│  Priority: High ▾                       │
│                                         │
│  ┌─ Dependencies ──────────────────┐    │
│  │  ✅ Schema migration            │    │
│  │  ✅ Password hashing util       │    │
│  │  + Add dependency...            │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─ YOLO Mode ─────────────────────┐   │
│  │  ○ Off  ● Manual  ○ Auto        │   │
│  │                                  │   │
│  │  On merge: start dependents     │   │
│  │  Dependents: Session mgmt,      │   │
│  │              Protected routes    │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌─ Session Cost ─────────────────┐   │
│  │  Total: $0.34                  │   │
│  │  #3 (running): $0.12 so far   │   │
│  │  #2 (done):    $0.18          │   │
│  │  #1 (failed):  $0.04          │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ┌─ Prompt ────────────────────────┐   │
│  │  Add a POST /api/auth/login     │   │
│  │  endpoint that accepts email    │   │
│  │  and password, validates against│   │
│  │  the users table, and returns   │   │
│  │  a JWT token...                 │   │
│  └──────────────────────────────────┘   │
│                                         │
│  ┌─ Claude Code Session ───────────┐   │
│  │  Model: claude-sonnet-4-6 ▾     │   │
│  │                                  │   │
│  │  [  🚀 Launch Claude Code    ]  │   │
│  │                                  │   │
│  │  Sessions:                       │   │
│  │   #3 ● Running (1:23)   View ▸  │   │
│  │   #2 ✅ Done (4:32)    Replay ▸ │   │
│  │   #1 🔴 Failed (2:11)  Replay ▸ │   │
│  └──────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘
```

### YOLO Pipeline Status (Task Card Badge)

Compact status shown on kanban task cards during YOLO execution.

```
┌─ Kanban Column: In Progress ────────────────┐
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Add login endpoint          YOLO 🟢  │  │
│  │  ──────────────────────────────────    │  │
│  │  ● PR #47 · CI passing · 0 comments   │  │
│  │  ██████████████████░░ $0.34            │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Session management          YOLO 🟡  │  │
│  │  ──────────────────────────────────    │  │
│  │  ● PR #48 · 2 comments · addressing   │  │
│  │  ████████░░░░░░░░░░░░  $0.17          │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐  │
│  │  Protected routes            YOLO ⏸   │  │
│  │  ──────────────────────────────────    │  │
│  │  Blocked: waiting on 2 dependencies    │  │
│  └────────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

## Known Issues

- **Missing "Start session with Claude" button** — does not display in one version of the task detail view. See GitHub issue.

## Technical Notes

### Why Not Use an External DAG Library?

The DAG logic needed is minimal (~50 lines):
- `dependsOn` array on task schema
- Cycle detection via DFS on add
- Fan-out query on task completion

Convex's reactive queries handle the real-time propagation. External libraries add complexity without value.

### YOLO Comment Handler Architecture

The comment handler needs to:
- Use `gh` CLI to poll PR comments and check statuses
- Classify comments (could use Claude itself for classification)
- Spawn targeted Claude Code sessions to address fixable issues
- Use `gh` CLI to reply/resolve comments
- Check CI status via GitHub Actions API

This fits naturally as a Convex action that orchestrates `gh` CLI calls and Claude Code sessions through the existing companion process.

### Leveraging Claude Code `/loop` for YOLO

Claude Code's `/loop` command (March 2026) provides session-scoped cron scheduling — exactly what we need for several YOLO pipeline stages. Instead of building our own polling infrastructure, we can inject `/loop` commands into session prompts and let Claude Code handle the scheduling natively.

**How `/loop` works:**
- `/loop 5m check if the deployment finished` — fires a prompt every 5 minutes
- Session-scoped: runs while the Claude Code process is alive, auto-expires after 3 days
- Up to 50 concurrent scheduled tasks per session
- Uses `CronCreate`/`CronList`/`CronDelete` tools under the hood
- No catch-up for missed fires; waits if Claude is busy

**Key insight:** Our YOLO pipeline currently proposes building a custom Convex polling action for PR comment handling and CI monitoring. `/loop` eliminates that entirely — we can spawn a single long-lived "watcher" session per YOLO task that monitors and acts autonomously.

#### Architecture: Two-Session YOLO

Instead of one session per task, YOLO tasks get two:

```
Session 1: "Worker" (short-lived)
  - Receives the task prompt
  - Writes code, runs tests, creates PR
  - Exits when done

Session 2: "Watcher" (long-lived)
  - Spawned after Worker creates a PR
  - Injected prompt:
      /loop 5m check PR #47 for new comments. For each unresolved comment:
      classify it, fix bugs, reply to questions, resolve false positives.
      If CI is green and all comments are resolved, auto-merge the PR
      and exit.
  - Self-terminates when PR is merged or task is paused
```

**Advantages over custom polling:**
- No Convex action scheduler to build and maintain
- Claude itself classifies and addresses comments (no separate classification step)
- `/loop` handles interval timing, jitter, and missed-fire semantics
- The watcher session has full context: the repo, the PR, `gh` CLI, and Claude's reasoning
- We get session replay for free on the watcher too — full audit trail of every poll

**Watcher session prompt template:**
```
You are monitoring PR #{prNumber} on {repo} for task "{taskTitle}".

/loop {interval} /review-pr-comments {prNumber}

After each review cycle, check:
1. Are all review comments resolved?
2. Is CI passing? (gh pr checks {prNumber})

If both are true:
- {autoYolo ? "Merge the PR: gh pr merge {prNumber} --squash" : "Notify that PR is ready for manual merge"}
- Exit this session

If CI is failing, attempt a fix (max 2 retries).
If a comment reveals a real bug, push a fix commit.

Budget: stop after {maxCostUsd} spent or {maxDuration} elapsed.
```

**What this replaces in the plan:**
- ~~Custom Convex polling action~~ → `/loop` in watcher session
- ~~Comment classification service~~ → Claude's native reasoning
- ~~CI status checker~~ → `gh pr checks` inside `/loop`
- ~~Auto-merge service~~ → `gh pr merge` inside watcher session

**What we still build ourselves (Holophyte orchestrator layer):**
- Spawning/stopping watcher sessions (Agent SDK)
- Streaming watcher events to the UI (existing WebSocket infra)
- DAG advancement when a watcher reports PR merged (Convex mutation)
- Cost enforcement — kill the watcher if cost limit hit
- Emergency stop — kill the watcher if task is paused

#### Impact on Phased Plan

`/loop` simplifies Phase 3 significantly:
- Phase 2 item 7 (PR comment handler) becomes: "spawn a watcher session with `/loop /review-pr-comments`"
- Phase 3 items 8-9 (YOLO Manual/Auto) share the same watcher — only the merge gate differs (prompt template conditional)
- Phase 3 item 10 (Epic YOLO) is unchanged — DAG advancement still lives in Convex

**Estimated effort reduction:** ~40% less custom code for the YOLO pipeline. The watcher pattern also makes the system more debuggable since every poll cycle is visible in session replay.

#### Limitations & Mitigations

| Limitation | Mitigation |
|---|---|
| Session must stay alive | Holophyte's companion process already runs persistently; watcher sessions are just long-lived Agent SDK spawns |
| 3-day auto-expiry | Holophyte detects expiry via session exit event and respawns if PR is still open |
| No catch-up on missed fires | Acceptable — PR comments don't need sub-minute latency |
| 50 task limit per session | One watcher per YOLO task, each with 1-2 loops — well within limits |
| Cost of idle polling | Cost controls cap total spend; most polls are cheap (just `gh` CLI calls) |

### Auto-Merge Safety

Auto YOLO should have guardrails:
- Only auto-merge to non-protected branches (never main/master directly)
- Require at least one CI check to pass (not just "no checks configured")
- Configurable cooldown period before merge (e.g., 5 min after last comment resolved)
- User can always override/pause YOLO per-task
- Emergency stop: mark task as "paused" to halt the pipeline
