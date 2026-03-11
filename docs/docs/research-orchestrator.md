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

### Auto-Merge Safety

Auto YOLO should have guardrails:
- Only auto-merge to non-protected branches (never main/master directly)
- Require at least one CI check to pass (not just "no checks configured")
- Configurable cooldown period before merge (e.g., 5 min after last comment resolved)
- User can always override/pause YOLO per-task
- Emergency stop: mark task as "paused" to halt the pipeline
