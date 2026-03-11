# Holophyte: Product Research & Strategy
## Making a Best-in-Class AI Agent Orchestrator with Accessibility-First, ADHD-Friendly Design

**Date:** March 11, 2026
**Author:** Product Research (PM/UX/Staff Engineering synthesis)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Competitive Landscape](#competitive-landscape)
4. [Accessibility Audit & Strategy](#accessibility-audit--strategy)
5. [ADHD-Friendly Design Principles](#adhd-friendly-design-principles)
6. [Feature Proposals — Novel Differentiators](#feature-proposals--novel-differentiators)
7. [Focus Mode — Deep Dive](#focus-mode--deep-dive)
8. [Missing Capabilities for Increased Power](#missing-capabilities-for-increased-power)
9. [Implementation Priority Matrix](#implementation-priority-matrix)
10. [Technical Architecture Notes](#technical-architecture-notes)

---

## Executive Summary

Holophyte is a project management app for orchestrating parallel Claude Code sessions, with a kanban board UI for task management and real-time agent session streaming. After extensive research across the codebase, competitor landscape, accessibility standards, and ADHD-focused UX patterns, this document proposes a strategy to make Holophyte **the most accessible AI agent orchestrator** — a genuinely unoccupied market position.

### Key Strategic Insights

1. **No competitor prioritizes accessibility.** Not Devin, not Cursor, not OpenHands. This is Holophyte's fastest path to differentiation.
2. **ADHD-friendly design is universally better design.** Reducing cognitive load, progressive disclosure, and context recovery help *all* users — ADHD users just need it more.
3. **The review bottleneck is the #1 unsolved problem** in multi-agent orchestration. Tools that help humans *review* agent output faster win.
4. **"Body doubling" is Holophyte's hidden superpower.** Visible parallel agent activity provides ambient accountability that helps ADHD users maintain focus — and no competitor has named or designed for this.
5. **Focus Mode is not "hide distractions."** It's a rethinking of the entire interaction model to support deep work on one task while agents handle the rest.

### What Holophyte Has Today

- Kanban board with 5 columns + Archive
- Claude Code sessions via Agent SDK with real-time streaming
- Multi-session per task, approval workflows, 3 permission modes
- Seed box for idea capture, prompt templates & history
- Multi-tenant orgs with RBAC, labels, priorities, due dates
- Command palette (Cmd+K), 8 themes, TanStack Router

### What's Missing (High Impact)

- Keyboard alternatives for drag-and-drop
- Screen reader support for live session updates
- Focus mode / distraction-free work view
- Codex CLI agent support (currently Claude Code only)
- Agent-to-agent coordination
- Cost tracking and visibility
- Notification system
- Context preservation across sessions

---

## Current State Analysis

### Architecture Strengths

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                    │
│  Convex useQuery/useMutation  ←→  Real-time data sync   │
│  Zustand (UI state)           ←→  localStorage persist   │
│  TanStack Router              ←→  Nested routes          │
└────────────────────────┬────────────────────────────────┘
                         │ Convex subscriptions
┌────────────────────────┴────────────────────────────────┐
│                  Convex (Real-time DB)                    │
│  repos, tasks, sessions, sessionEvents, pendingApprovals │
│  labels, seeds, promptTemplates, promptHistory           │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP internal API
┌────────────────────────┴────────────────────────────────┐
│              Companion (Bun.serve)                        │
│  Polls Convex → spawns Claude Code via Agent SDK          │
│  Streams events → flushes to Convex in batches            │
│  Handles approvals, heartbeat, session lifecycle          │
└─────────────────────────────────────────────────────────┘
```

**What works well:**
- Real-time Convex subscriptions eliminate polling on frontend
- Session event batching is efficient (1s flush interval)
- Permission modes (default/safe-auto/bypass) are well-designed
- Seed box → Task conversion is a nice ideation workflow
- Prompt history with restore is genuinely useful

**What needs work:**
- No notification layer — status changes are silent
- No keyboard DnD — cards are mouse-only for reordering
- Session panel lacks `role="log"` and `aria-live`
- No cost tracking or resource visibility
- Single agent type (Claude Code only, no Codex CLI)

### Accessibility Gaps (Detailed)

| Category | Current State | WCAG Criterion | Severity |
|----------|--------------|----------------|----------|
| Drag-and-drop | Mouse-only, no keyboard alternative | 2.5.7 Dragging Movements | **Critical** |
| Live session updates | No `aria-live` on session stream | 4.1.3 Status Messages | **Critical** |
| Color-only status | Priority dots, session status use color alone | 1.4.1 Use of Color | **High** |
| Focus management | Dialogs don't trap focus, no focus return | 2.4.3 Focus Order | **High** |
| Target size | Some icon buttons are 28x28px (h-7 w-7) | 2.5.8 Target Size | **Medium** |
| Landmarks | No skip links, no landmark regions | 2.4.1 Bypass Blocks | **Medium** |
| Approval urgency | Approval prompts not announced assertively | 4.1.3 Status Messages | **Medium** |
| Streaming content | No pause/stop for fast-updating session logs | 2.2.2 Pause, Stop, Hide | **Medium** |

---

## Competitive Landscape

### Direct Competitors (Multi-Agent Orchestrators)

| Tool | Type | Multi-Agent | Task UI | Accessibility | ADHD Focus |
|------|------|-------------|---------|---------------|------------|
| **Devin 2.0** | Cloud IDE | Yes (via Devin Teams) | Slack-like threads | None stated | No |
| **Cursor 2.0** | Desktop IDE | 8 parallel agents, worktrees | IDE tabs | Basic (VSCode inherited) | No |
| **Windsurf** | Desktop IDE | Cascade flow agents | IDE-embedded | Basic | No |
| **Superset IDE** | Terminal | 10+ parallel CLI agents | Terminal panes | None | No |
| **Capy AI** | Cloud platform | Captain + Build agents | Task-based | None stated | No |
| **OpenHands** | Open source | Multi-agent runtime | Web terminal | None | No |
| **Codex CLI** | Terminal | Single agent | CLI | None | No |
| **Claude Code** | Terminal | Agent teams | CLI + `/status` | None | No |
| **Aider** | Terminal | Architect + Editor | CLI | None | No |
| **Holophyte** | Web app | Parallel sessions | Kanban board | Partial | **Opportunity** |

### Key Takeaways

1. **No one owns "accessible AI orchestrator."** Every competitor treats accessibility as an afterthought. The European Accessibility Act (enforced June 2025) and ADA Title II (April 2026) mean legal mandates are here.

2. **The Kanban UI is rare.** Most competitors are IDE-embedded or terminal-only. Holophyte's visual task board is a genuine differentiator for non-terminal-native users.

3. **Parallel agents via worktrees is standard.** Cursor 2.0, Superset, Capy all do it. Holophyte already supports this architecture.

4. **Cost visibility is table stakes.** Users report $70-100/night costs with Devin. Transparent cost tracking is missing from most tools but expected by teams.

5. **The review bottleneck is unsolved.** As one HN commenter noted: "You're converting 'typing time' into 'reading time,' which is usually worse." Tools that reduce review cognitive load win.

### What Competitors Do Well That Holophyte Doesn't

- **Cursor/Windsurf**: Inline code diffs with accept/reject per chunk
- **Devin**: Full cloud environment with browser, shell, editor
- **Capy**: Automated branching + PR creation per task
- **Claude Code Teams**: Agent-to-agent messaging, role specialization
- **Superset**: 10+ simultaneous agents with automatic worktree isolation
- **Augment Code**: Typed task lifecycle as first-class entity with analytics

---

## Accessibility Audit & Strategy

### WCAG 2.2 AA Compliance Roadmap

#### Phase 1: Critical Fixes (Must-Have)

**1. Accessible Drag-and-Drop (WCAG 2.5.7)**

The new WCAG 2.2 Success Criterion 2.5.7 requires that for any action achievable through dragging, there must be a single-pointer alternative that does not require dragging.

**Recommended pattern (from Atlassian Pragmatic DnD):**

Rather than making assistive tech "do" drag-and-drop, provide equivalent outcomes through familiar UI patterns:

- Add an **action menu** (three-dot or drag handle) to each TaskCard
- Menu items: "Move to Backlog", "Move to To Do", "Move to In Progress", "Move to Review", "Move to Done"
- For reordering within a column: "Move up", "Move down", "Move to top", "Move to bottom"
- Announce result: `aria-live="polite"` region says "Task 'Fix auth bug' moved to In Progress"

```
┌──────────────────────────────┐
│ ⋮⋮  Fix authentication bug   │  ← drag handle doubles as menu trigger
│     ┌──────────────────┐     │
│     │ Move to Backlog  │     │  ← keyboard-accessible menu
│     │ Move to To Do    │     │
│     │ Move to In Prog  │     │
│     │ Move to Review   │     │
│     │ Move to Done     │     │
│     │───────────────────│     │
│     │ Move up          │     │
│     │ Move down        │     │
│     └──────────────────┘     │
└──────────────────────────────┘
```

**2. Live Session Announcements (WCAG 4.1.3)**

Session events stream at high frequency. Direct `aria-live` on every event would overwhelm screen readers.

**Recommended pattern:**

```html
<!-- Session log container -->
<div role="log" aria-label="Agent session output" aria-live="off">
  <!-- Individual messages rendered here -->
</div>

<!-- Separate, debounced status announcer -->
<div aria-live="polite" aria-atomic="true" class="sr-only">
  <!-- Updated every 3-5 seconds with a summary -->
  "Agent is editing src/auth.ts — 12 actions completed"
</div>

<!-- Approval announcements (assertive — needs immediate attention) -->
<div aria-live="assertive" class="sr-only">
  "Approval required: Agent wants to run 'rm -rf node_modules'"
</div>
```

Key principles:
- Use `role="log"` on the session thread container (sequential, time-ordered)
- Debounce `aria-live="polite"` updates to every 3-5 seconds with summaries
- Use `aria-live="assertive"` ONLY for approval requests
- Add `aria-busy="true"` during rapid streaming, remove when idle
- Provide a pause/resume button for the session stream display

**3. Color-Independent Status (WCAG 1.4.1)**

Never rely on color alone. Pair every color indicator with shape, icon, or text:

| Status | Current (Color Only) | Proposed (Color + Shape + Text) |
|--------|---------------------|--------------------------------|
| Running | Green dot | Green dot + pulse animation + "Running" text |
| Idle | Gray dot | Gray circle outline + "Idle" text |
| Queued | Yellow dot | Yellow clock icon + "Queued" text |
| Failed | Red dot | Red triangle/exclamation + "Failed" text |
| Waiting approval | Amber dot | Amber hand icon + "Needs approval" text |

For priority indicators, add icons:
- Urgent: Red double-arrow-up `⏫`
- High: Orange arrow-up `↑`
- Medium: Blue dash `—`
- Low: Gray arrow-down `↓`

#### Phase 2: Important Improvements

**4. Focus Management**
- Trap focus in modal dialogs (Dialog component from Radix should do this — verify implementation)
- Return focus to trigger element when dialogs/panels close
- Auto-focus the most relevant element when session state changes (e.g., focus approve button when approval arrives)

**5. Keyboard Navigation**
- Add landmark regions: `<nav>` for sidebar, `<main>` for board, `<aside>` for detail panel
- Add skip links: "Skip to board", "Skip to session", "Skip to task details"
- Implement roving tabindex for kanban columns (arrow keys between columns, tab to enter column)
- `Escape` should close the most recently opened panel/dialog

**6. Target Size**
- Ensure all interactive elements are at least 24x24px (WCAG 2.5.8 minimum)
- Sidebar icon buttons (currently h-7 = 28px) are borderline — ensure padding gives 24px touch target

#### Phase 3: Enhanced Experience

**7. Reduced Motion**
- Wrap all animations in `motion-safe:` (already partially done)
- Ensure drag-drop preview, card transitions, and pulse animations respect `prefers-reduced-motion`

**8. High Contrast Mode**
- Test with `forced-colors: active` media query
- Ensure focus indicators are visible in Windows High Contrast Mode
- Use `currentColor` for SVG icons

**9. Screen Reader Testing**
- Test full flows with NVDA (Windows), VoiceOver (macOS), JAWS
- Priority flows: Create task → Start session → Review approval → Approve/Deny → Check result

---

## ADHD-Friendly Design Principles

### Research Findings

ADHD affects working memory, sustained attention, and executive function. The core challenge isn't *paying attention* — it's *directing and sustaining* attention on the right thing. Software design for ADHD should:

1. **Reduce decision paralysis** (Hick's Law — fewer visible choices)
2. **Support context recovery** (what was I doing? what's the state?)
3. **Provide ambient progress feedback** (non-disruptive confirmation that things are moving)
4. **Enable hyperfocus without punishment** (don't penalize deep work with notifications)
5. **Make task transitions frictionless** (reduce the activation energy to start next task)

### Design Principles for Holophyte

#### Principle 1: "Gentle Accountability" over Gamification

**Why:** ADHD users often respond negatively to gamification (streaks, badges, leaderboards) because:
- Missed streaks trigger shame spirals
- Points systems become the focus instead of the work
- Competition adds anxiety

**Instead:** Use *ambient presence* — the feeling that agents are working alongside you, like a coworker in a coffee shop.

**Implementation ideas:**
- **Companion pulse**: Show a subtle breathing animation when the companion process is healthy and agents are active. Not flashy — just *present*.
- **"Working alongside you" indicator**: Instead of "3 agents running", show "3 agents are working with you right now" — reframe from status to companionship.
- **Gentle progress toasts**: "✓ Auth module tests pass" rather than "TASK COMPLETE! +50 XP!!!"
- **No-judgment task rollover**: Tasks that miss their due date just quietly roll forward. No red "OVERDUE" screaming — just a neutral indicator and option to reschedule.

#### Principle 2: Progressive Disclosure Everywhere

**Why:** ADHD users are overwhelmed by dense information. They need to see the minimum to make the next decision.

**Apply to Holophyte:**

| Component | Current | Proposed |
|-----------|---------|----------|
| KanbanBoard | All columns always visible | Collapse done/backlog by default, expand on hover/click |
| TaskCard | Shows labels, priority, due, session, subtasks | Show title + status only; expand details on hover or focus |
| SessionPanel | Full event stream always visible | Show latest message + summary; expand for full history |
| TaskDetailPanel | All fields visible at once | Sections: Essential (title, status, prompt) → Details (priority, labels, due) → History (prompts, sessions) |

#### Principle 3: Context Recovery — "Where Was I?"

**Why:** ADHD users frequently context-switch (by choice or interruption). Coming back to a tool after 20 minutes should be *instant re-orientation*, not archaeology.

**Implementation ideas:**

- **Session summary on return**: When user opens a task they haven't looked at in >5 minutes, show a 1-sentence AI-generated summary: "Last session edited 3 files in src/auth/. Tests pass. Waiting for your review of the login redirect change."
- **"Resume where you left off" banner**: On app load, show: "You were reviewing Task X. Agent finished 12 minutes ago. [Jump to review →]"
- **Active task breadcrumb**: Persistent, minimal breadcrumb showing: `Auth Module > Fix OAuth redirect > Session 3 (idle)`
- **Recency-sorted task view**: Option to sort tasks by "last interacted" instead of kanban position

#### Principle 4: Notification Triage (Not Bombardment)

**Why:** ADHD users are either hyper-responsive to notifications (constant checking) or completely overwhelmed and ignore them all.

**Proposed notification tiers:**

| Tier | When | Delivery | Example |
|------|------|----------|---------|
| **Urgent** | Approval needed, agent failed | Assertive sound + visual + `aria-live="assertive"` | "Agent needs approval to delete files" |
| **Informative** | Session complete, task moved | Badge count + `aria-live="polite"` | "Auth session completed — 5 tests pass" |
| **Ambient** | Agent working, heartbeat | Subtle visual indicator only | Companion pulse animation |
| **Digest** | Periodic summary | On-demand or scheduled | "Today: 3 sessions completed, 1 needs review" |

Users should be able to configure which tier they see via a simple toggle, not a 15-option settings page.

#### Principle 5: Reduce Activation Energy

**Why:** Starting a task is the hardest part for ADHD users. Every click, every decision, every "configure before you begin" is friction.

**Ideas:**
- **One-click session start**: If a task has a prompt, show a single "Start Agent" button. No model picker, no permission mode selector as required steps — use smart defaults with an expandable "Advanced" section.
- **Quick capture → Quick start**: From the command palette (Cmd+K), type a task title, press Enter → task created in "To Do". Type prompt, press Enter → session starts. Two interactions from idea to running agent.
- **"Do this next" suggestion**: When a session completes, the UI suggests the next logical action: "Run tests?", "Review diff?", "Start next task?" — rather than leaving the user staring at an idle session.

---

## Feature Proposals — Novel Differentiators

These are features designed to make Holophyte genuinely unique, not just "accessible Devin."

### 1. The Presence Engine (Body Doubling for Code)

**Concept:** ADHD research shows that "body doubling" — having another person present while you work — dramatically improves focus. Holophyte's parallel agents are a *digital body double*.

**Implementation:**

```
┌─────────────────────────────────────────────────────────────────┐
│ 🤝 Working Together                                             │
│                                                                  │
│ You: reviewing auth changes              (12 min)                │
│ Agent 1: writing tests for payment module (3 min, 47% done)      │
│ Agent 2: refactoring user model          (8 min, idle — needs    │
│                                           your input)            │
│                                                                  │
│ ──────────────────────────────────────────                       │
│ Combined progress: ████████░░ 73% of today's tasks               │
└─────────────────────────────────────────────────────────────────┘
```

This is not a dashboard. It's a *co-presence indicator* — designed to sit at the top or bottom of the screen, providing ambient awareness without demanding attention. Key design decisions:
- Uses natural language ("writing tests") not technical jargon ("executing mutation")
- Shows *your* activity alongside agent activity — you're part of the team
- Progress is approximate and non-judgmental
- Clicking any line jumps to that task/session

**Why this is novel:** No competitor frames agents as *companions*. They're all "tools you command." The body doubling framing is psychologically different and supports ADHD users specifically.

### 2. The Review Accelerator

**Concept:** The #1 pain point in multi-agent workflows is reviewing agent output. Holophyte should make reviewing *faster than writing*.

**Implementation ideas:**

- **Diff summaries**: Instead of showing raw file diffs, show: "Changed: login redirect now goes to `/dashboard` instead of `/home`. Added null check for session token. Modified 2 files, +14/-8 lines."
- **Confidence indicators**: Agent annotates its own changes with confidence: "High confidence (pattern match from tests)", "Low confidence (first time seeing this codebase pattern)". User focuses review on low-confidence areas.
- **Review queue**: Across all running agents, show a unified queue of "things needing human eyes" — sorted by priority, filterable by confidence.
- **One-click approval patterns**: For common review outcomes:
  - "Looks good, commit" → approves all pending + creates commit
  - "Run tests first" → triggers test run, auto-approves if green
  - "Let me see the diff" → opens diff view inline
  - "Redo this part" → sends feedback to agent with context

**Why this is novel:** All competitors show you the raw agent output. None help you *process* it faster. This is where productivity gains compound.

### 3. Context Fabric (Cross-Session Memory)

**Concept:** Currently, each Claude Code session starts fresh. Knowledge from session 1 doesn't carry to session 2 on the same task (unless the user manually provides context).

**Implementation:**

- **Automatic context file**: For each task, Holophyte maintains a `.holophyte/context-{taskId}.md` that accumulates:
  - Files modified across all sessions
  - Key decisions made (extracted from agent reasoning)
  - Test results
  - Errors encountered and their resolutions
  - User feedback/corrections

- **Session preamble injection**: When starting a new session on a task, Holophyte prepends: "Previous sessions on this task established: [context summary]. Continue from this state."

- **Cross-task context**: If Task B depends on Task A, Holophyte can inject Task A's context into Task B's session: "Related task 'Add user model' completed. Changes are in `src/models/user.ts`. Tests pass."

**Why this is novel:** Microsoft's CORPGEN research shows hierarchical context management gives 3.5x performance improvement. Augment Code treats tasks as typed entities with lifecycle. Holophyte can do both — persistent context + structured lifecycle.

### 4. Multi-Runtime Agent Support

**Concept:** Support both Claude Code (Anthropic) and Codex CLI (OpenAI) as agent runtimes, with a unified interface.

**Implementation:**

- **Agent runtime selector**: Per-task dropdown to choose "Claude Code" or "Codex CLI"
- **Unified event protocol**: Both runtimes emit different event formats. Normalize them into Holophyte's internal event schema:
  ```
  { type: "tool_use" | "message" | "thinking" | "approval_request",
    runtime: "claude-code" | "codex-cli",
    data: RuntimeSpecificPayload,
    timestamp: number }
  ```
- **Comparative runs**: Start the same task with both runtimes, compare output quality and cost
- **Best-of-N**: For critical tasks, run N agents (mix of runtimes), pick the best result

**Why this is novel:** No tool is runtime-agnostic. Users are locked into one provider. Holophyte becomes "the orchestrator" rather than "the Claude UI."

### 5. Adaptive UI Density

**Concept:** Instead of one-size-fits-all UI, let users choose their information density — not just "compact/comfortable" but context-dependent density.

**Three modes:**

| Mode | When | What's Visible |
|------|------|----------------|
| **Scan** | Quick overview of all work | Task titles + status dots only, no cards expanded, compact columns |
| **Work** | Active development | Current task expanded, session panel open, other tasks as cards |
| **Focus** | Deep review or writing | Single task full-screen, session output + code diff, everything else hidden |

Users can switch instantly via keyboard shortcut (`1` / `2` / `3` or `Cmd+Shift+S/W/F`).

The UI transitions should respect `prefers-reduced-motion` — instant switch instead of animated transition.

---

## Focus Mode — Deep Dive

Focus Mode is the signature ADHD-friendly feature. It's not just "hide the sidebar." It's a complete rethinking of what the UI shows when you need to concentrate on one thing.

### Design Philosophy

> "Focus Mode doesn't remove features — it removes decisions."

The user shouldn't have to think about *what to look at*. Focus Mode answers: "Here is the one thing that matters right now. Everything else is handled."

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Back to Board    Fix OAuth Redirect (#42)    ⏸ Pause Agent  │
│─────────────────────────────────────────────────────────────────│
│                                                                  │
│  ┌─────────────────────────────┬──────────────────────────────┐ │
│  │                             │                              │ │
│  │     Agent Session Output    │      Task Details /          │ │
│  │                             │      Code Diff /             │ │
│  │  [Streaming messages with   │      Review Panel            │ │
│  │   syntax-highlighted code]  │                              │ │
│  │                             │  ┌──────────────────────┐    │ │
│  │                             │  │ Summary: Modified     │    │ │
│  │                             │  │ 3 files, added OAuth  │    │ │
│  │                             │  │ redirect handler.     │    │ │
│  │                             │  │ Tests: 12/12 pass ✓   │    │ │
│  │                             │  └──────────────────────┘    │ │
│  │  ┌────────────────────────┐ │                              │ │
│  │  │ 💬 Send follow-up...   │ │  [Approve All] [Review Diff] │ │
│  │  └────────────────────────┘ │                              │ │
│  └─────────────────────────────┴──────────────────────────────┘ │
│                                                                  │
│  ───────────────────────────────────────────────────────────     │
│  🤝 2 other agents working  │  Agent 1: tests (41%)  │ ...      │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Single task, full viewport**: No sidebar, no kanban board, no other task cards visible
2. **Split view: Session + Review**: Left panel shows agent conversation, right panel shows contextual information (task description → code diff → test results, depending on session state)
3. **Presence bar at bottom**: The body-doubling strip shows other agents working — ambient, not distracting. Collapsible with one click.
4. **Minimal chrome**: Top bar has only: Back button, task title, and session control. No menu, no settings, no org switcher.
5. **Smart right panel**: Content changes based on session state:
   - Session starting → shows task description and prompt
   - Session running → shows files being modified (live)
   - Session idle → shows diff summary + review actions
   - Approval needed → shows approval request with context

### Entry/Exit

- **Enter**: Click "Focus" on any task card, or `Cmd+Shift+F` from any view
- **Exit**: Click "← Back to Board" or press `Escape`
- **Auto-enter suggestion**: When user starts a session, offer "Enter Focus Mode?" as a non-blocking toast
- **Keyboard**: All Focus Mode actions accessible via keyboard — no mouse required

### Accessibility in Focus Mode

- Full keyboard navigation: `Tab` between panels, arrow keys within panels
- `role="main"` on the focus container
- `aria-label="Focus mode for task: Fix OAuth Redirect"`
- Live region for session status changes
- Skip link: "Skip to session output" / "Skip to review panel"
- Escape always exits (consistent, predictable)

### ADHD-Specific Touches

- **Time awareness**: Subtle, non-alarming elapsed time indicator: "You've been focused for 23 minutes" — no countdown, no pressure
- **Transition prompts**: When session completes, gentle: "Session done. Take a look when you're ready." — not an alarm
- **Snooze approvals**: If an approval comes in during deep focus, option to "Remind me in 5 min" instead of forcing an immediate decision
- **Auto-save everything**: Description, prompt, notes — always saved. Never lose work because you switched context

---

## Missing Capabilities for Increased Power

Beyond UX improvements, these features would increase Holophyte's raw capability as an orchestrator.

### 1. Agent Coordination Layer

**Current limitation:** Each session is isolated. Agent 1 and Agent 2 can't share information.

**Proposed:** Lightweight coordination via Convex:
- **Shared context documents**: Per-repo context file updated by all agents
- **File locking**: If Agent 1 is editing `auth.ts`, Agent 2 gets a "skip this file" signal
- **Dependency awareness**: Task B marked as "depends on Task A" — Agent B waits for Agent A to finish or reads A's output

**Architecture:**
```
convex/coordination.ts
  - lockFile(sessionId, filePath) → returns success/conflict
  - unlockFile(sessionId, filePath)
  - getTaskContext(taskId) → accumulated context
  - updateTaskContext(taskId, entry) → append to context
  - getDependencies(taskId) → list of prerequisite tasks + their status
```

### 2. Cost Tracking & Budget Controls

**Why:** Users report $70-100/night costs with competing tools. Cost transparency builds trust.

**Proposed:**
- Track token usage per session (prompt tokens, completion tokens)
- Show running cost in session panel: "$0.47 so far"
- Daily/weekly cost summaries in org settings
- Optional budget limits: "Warn at $10/day, pause at $25/day"
- Cost comparison when multi-runtime is supported: "This task cost $2.10 with Claude Code vs $1.80 with Codex"

### 3. Webhook & Integration Layer

**Missing today:** No way to connect Holophyte to external systems.

**Proposed (prioritized):**
- **GitHub integration**: Auto-create PR from agent session, link task to issue, sync status
- **Slack/Discord notifications**: "Agent completed task X" messages to team channels
- **Custom webhooks**: POST to any URL on session events (complete, failed, needs_approval)

### 4. Task Templates & Blueprints

**Missing today:** Every task starts from scratch.

**Proposed:**
- **Task templates**: Pre-filled title, description, prompt, labels for common patterns ("Bug fix", "Feature", "Refactor", "Test coverage")
- **Blueprint chains**: Template that creates multiple tasks with dependencies ("API endpoint" → creates schema task, handler task, test task, all linked)

### 5. Session Analytics & Learning

**Missing today:** No learning from past sessions.

**Proposed:**
- Track which prompts produce best results (by outcome: tests pass, minimal revisions needed)
- Suggest prompt improvements: "Tasks with 'write tests first' in the prompt complete 40% faster"
- Session replay: Step through a completed session's events like a recording
- Failure analysis: "This agent failed because X. Similar tasks succeeded when Y."

### 6. Offline-First / Low-Connectivity Support

**Missing today:** Requires constant connection to Convex.

**Proposed:**
- Queue task creation and edits offline
- Sync when connection restores
- Show clear offline indicator
- Companion process continues running agents even if browser is closed (already works — just needs better UX for "check back later")

---

## Implementation Priority Matrix

### Impact vs. Effort Framework

```
                         HIGH IMPACT
                            │
     ┌──────────────────────┼──────────────────────┐
     │                      │                      │
     │  PHASE 1 (NOW)       │  PHASE 2 (NEXT)      │
     │                      │                      │
     │  • Keyboard DnD alt  │  • Focus Mode        │
     │  • aria-live session  │  • Presence Engine   │
     │  • Color-independent │  • Codex CLI support │
     │    status indicators │  • Review Accelerator│
     │  • Focus management  │  • Context Fabric    │
LOW  │  • Skip links/       │  • Notification tiers│  HIGH
EFFORT│    landmarks         │  • Cost tracking     │  EFFORT
     │                      │                      │
     │──────────────────────┼──────────────────────│
     │                      │                      │
     │  PHASE 3 (LATER)     │  PHASE 4 (FUTURE)    │
     │                      │                      │
     │  • Reduced motion    │  • A2A protocol      │
     │  • High contrast     │  • GitHub integration│
     │  • Adaptive density  │  • Task blueprints   │
     │  • Screen reader     │  • Session analytics │
     │    testing & fixes   │  • Agent coordination│
     │  • Target size fixes │  • Offline support   │
     │                      │                      │
     └──────────────────────┼──────────────────────┘
                            │
                         LOW IMPACT
```

### Phase 1: Accessibility Foundation (2-3 weeks)

| Task | Files Affected | Effort |
|------|---------------|--------|
| Add action menu to TaskCard for DnD alternative | `TaskCard.tsx`, `KanbanColumn.tsx` | 2 days |
| Add `role="log"` + debounced `aria-live` to SessionPanel | `SessionPanel.tsx`, `SessionThread.tsx` | 1 day |
| Add icon/text fallbacks for all color-only indicators | `SessionStatusDot.tsx`, `TaskCard.tsx`, `Badge.tsx` | 1 day |
| Fix focus management in dialogs | `Dialog.tsx`, `CreateTaskDialog.tsx`, `AddRepoDialog.tsx` | 1 day |
| Add landmark regions + skip links | `RootLayout.tsx`, new `SkipLinks.tsx` | 0.5 day |
| Assertive announcements for approvals | `ApprovalButtons.tsx`, `SessionPanel.tsx` | 0.5 day |

### Phase 2: ADHD-Friendly Features (4-6 weeks)

| Task | Files Affected | Effort |
|------|---------------|--------|
| Focus Mode (full viewport single-task view) | New route + components | 1 week |
| Presence Engine (body doubling strip) | New component, session store changes | 3 days |
| Notification tier system | New `notifications/` module, Zustand slice | 3 days |
| Context recovery ("where was I?") | New hook, session summary logic | 2 days |
| Progressive disclosure refactor | `TaskCard.tsx`, `TaskDetailPanel.tsx` | 2 days |
| Adaptive UI density (Scan/Work/Focus) | Zustand store, layout changes | 2 days |
| Codex CLI runtime adapter | New `src/claude/codex-adapter.ts`, manager changes | 1 week |

### Phase 3: Polish & Power (6-8 weeks)

| Task | Effort |
|------|--------|
| Review Accelerator (diff summaries, confidence, queue) | 1 week |
| Context Fabric (cross-session memory) | 1 week |
| Cost tracking | 3 days |
| Agent coordination layer | 1 week |
| Task templates & blueprints | 3 days |
| GitHub integration (PR creation) | 1 week |
| Session analytics | 3 days |

---

## Technical Architecture Notes

### Focus Mode Routing

```typescript
// Add to router.ts
'/repos/$repoId/tasks/$taskId/focus' → FocusRoute
```

Focus Mode is a dedicated route, not a CSS toggle. This means:
- URL-shareable: `holophyte.app/repos/abc/tasks/xyz/focus`
- Browser back button exits Focus Mode naturally
- Route guards can prevent accidental navigation away during active sessions

### Notification Architecture

```
convex/notifications.ts
  - Table: notifications { userId, type, taskId?, sessionId?, message, read, createdAt }
  - createNotification(userId, type, data)
  - markRead(notificationId)
  - getUnread(userId) → with Convex subscription for real-time

src/frontend/hooks/useNotifications.ts
  - Subscribes to Convex notifications query
  - Filters by user's notification tier preference
  - Manages toast display queue
  - Provides dismiss/snooze actions
```

### Codex CLI Integration

The Codex CLI integration would mirror the existing Claude Agent SDK pattern:

```
src/agents/
  ├── types.ts          → Unified event schema
  ├── claude-adapter.ts → Existing Claude Code logic (extracted from manager.ts)
  ├── codex-adapter.ts  → New Codex CLI adapter
  └── runtime.ts        → Runtime selection + lifecycle management
```

Each adapter implements:
```typescript
interface AgentRuntime {
  spawn(config: SessionConfig): AsyncIterable<AgentEvent>;
  stop(sessionId: string): Promise<void>;
  sendMessage(sessionId: string, message: string): Promise<void>;
  respondToApproval(requestId: string, approved: boolean, reason?: string): Promise<void>;
}
```

### Presence Engine Data Flow

```
Convex sessions (real-time)
  → usePresence() hook aggregates active sessions
  → Computes per-session: runtime, elapsed time, estimated progress
  → PresenceBar component renders the strip
  → Updates via Convex subscription (no additional polling)
```

Progress estimation heuristic:
- Track average session duration per task type (from historical data)
- Show approximate percentage based on elapsed / historical average
- Never show "100%" until actually complete
- If no historical data: show elapsed time only, no percentage

---

## Appendix: Key Research Sources

### Accessibility Standards
- WCAG 2.2 — SC 2.5.7 Dragging Movements, SC 4.1.3 Status Messages, SC 2.5.8 Target Size
- Atlassian Pragmatic Drag and Drop — accessibility guidelines (atlassian.design)
- MDN: aria-live attribute, ARIA live regions
- Sara Soueidan: Accessible Notifications with ARIA Live Regions

### ADHD & Cognitive Design
- W3C WCAG 2.2 Cognitive Accessibility supplemental guidance
- Research on body doubling as ADHD coping strategy
- Hick's Law in interface design for cognitive load reduction
- Progressive disclosure patterns for information-dense applications

### Competitor & Market
- Superset IDE: 10+ parallel agents via Git worktrees (launched March 2026)
- Cursor 2.0: 8 parallel background agents
- Capy AI: Captain + Build two-agent architecture
- Augment Code: Typed task lifecycle (augmentcode.com)
- ConTree (Nebius): Sandboxed branching for agent exploration
- Microsoft CORPGEN: Hierarchical planning across temporal scales

### Agent Protocols
- A2A (Agent-to-Agent Protocol) — Linux Foundation / Google (merged with IBM ACP)
- MCP (Model Context Protocol) — Anthropic
- Three-layer stack: MCP (tools) + A2A (agents) + AG-UI (user interaction)
- Agentic AI Foundation (AAIF) — co-founded Dec 2025 by OpenAI, Anthropic, Google, Microsoft, AWS

### Industry Trends
- European Accessibility Act enforced June 2025
- ADA Title II digital accessibility requirements April 2026
- Agent task duration doubling every 7 months (agents handling 2-hour tasks as of early 2026)
- 93.5% token waste reported in naive agent implementations
- Performance degradation after 35 minutes of agent runtime

---

*This document should be treated as a living research artifact. Update as competitor landscape evolves and user research provides feedback on proposed features.*
