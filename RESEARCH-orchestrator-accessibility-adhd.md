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
8. [Decision Queue — Deep Dive](#decision-queue--deep-dive)
9. [Companion Agent — Deep Dive](#companion-agent--deep-dive)
10. [Missing Capabilities for Increased Power](#missing-capabilities-for-increased-power)
11. [Implementation Priority Matrix](#implementation-priority-matrix)
12. [Technical Architecture Notes](#technical-architecture-notes)

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

Focus Mode is the full-viewport deep work view for a single task. It's not just "hide the sidebar." It's a complete rethinking of what the UI shows when you need to concentrate on one thing.

Focus Mode is complementary to the [Decision Queue](#decision-queue--deep-dive). The queue is the **attention router** ("what needs me?"), Focus Mode is the **deep work destination** ("let me go deep on this one task"). Common flow: queue item → open session → enter Focus Mode.

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

- **Enter**: Click "Focus" on any task card, from a queue item's "Show full session" link, or `Cmd+Shift+F` from any view
- **Exit**: Click "← Back" or press `Escape` — returns to wherever you came from (queue or board)
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

## Decision Queue — Deep Dive

The Decision Queue is Holophyte's primary daily interface — a single stream of actionable items that tells the user exactly what needs their attention right now. It replaces scattered notifications and kanban scanning with constrained, momentum-preserving decisions.

### The Core Problem

The queue solves the **orchestration problem at the human layer**. Existing tools orchestrate agents fine but leave the human to manage their own attention across parallel workstreams. For ADHD brains, this is where the system breaks down — not because the agents aren't working, but because the user can't efficiently context-switch between them.

The queue replaces "what should I be doing?" (open-ended, ADHD kryptonite) with "here's the one thing that needs you right now" (constrained, momentum-preserving).

### Relationship to Focus Mode

Focus Mode and the Decision Queue are complementary:

- **Decision Queue** = the attention router. "What needs me right now?" Surfaces the single most important decision across all active agents and tasks.
- **Focus Mode** = deep work on one task. "Let me go deep on this." Full-viewport session output + review panel for a single task.

Both are accessible from the main nav. Users choose their default landing page (queue or kanban board) in settings.

#### Depth Levels

The queue has natural "depth levels" based on effort. Most items resolve inline — Focus Mode only activates when you genuinely need to go deep.

| Depth | Action | Navigation |
|-------|--------|------------|
| **Inline** | Approve, deny, archive, confirm | Stay in queue. Never leave. |
| **Expand** | Error triage, merge decision | Expand item in-place for more context. Still in queue. |
| **Focus** | Code review, complex feedback | "Focus" button → full-viewport Focus Mode with session + diff. |

The key insight: **most queue items should never require leaving the queue.** Permission approvals, quick confirmations, task completions — these are 2-second actions. The queue's power is clearing 8 items in 30 seconds without navigating anywhere. Focus Mode only activates for deep work (reviewing a 4-file diff, writing a detailed follow-up, debugging a failed agent).

```
Queue (triage)
  │
  ├─ Quick wins → resolve inline, never leave the queue
  │   (approve, deny, archive completed task)
  │
  ├─ Medium items → expand in-place for more context
  │   (error triage, merge decision)
  │
  └─ Deep work → Focus Mode (full viewport)
      (code review, complex feedback)
```

### Queue Item Types

Every item in the queue represents a **decision the user needs to make**:

| Type | Source Event | User Action | Effort |
|------|-------------|-------------|--------|
| **Permission approval** | `canUseTool` callback | Approve / Reject / Approve All | Low |
| **Quick confirmation** | Agent asks yes/no question | Yes / No | Low |
| **Feedback request** | Agent needs clarification | Type a response | Medium |
| **Code review** | Agent completed, diff ready | Review diff, approve/request changes | High |
| **Merge decision** | Review approved, PR ready | Merge / Defer / Edit | Medium |
| **Error triage** | Agent failed or stalled | Retry / Edit prompt / Kill | Medium |
| **Task completion** | Agent finished successfully | Archive / Start follow-up | Low |

### Priority Algorithm

Not FIFO. Items are scored by decision effort, urgency, and blocking impact:

```
score = effortWeight + blockingBonus + agingBonus + urgencyBonus
```

**Effort weight** (lower effort = higher priority — clear quick wins first):
- Permission approval: 100
- Quick confirmation: 90
- Task completion: 80
- Error triage: 70
- Merge decision: 60
- Feedback request: 50
- Code review: 40

**Blocking bonus** (+30 if other agents are waiting on this task's completion)
**Aging bonus** (+2 per minute in queue, capped at +40)
**Urgency bonus** (inherited from task priority: urgent=+50, high=+25, normal=+0)

**Why quick wins first:** This is the ADHD-critical design decision. Clearing a permission approval takes 2 seconds and unblocks an agent. Clearing five of those before a code review creates **momentum** — the user feels productive and builds energy for the harder review. Traditional FIFO interleaves heavy reviews with quick approvals, breaking flow. Offer a toggle between "Quick wins first" (default) and "Chronological" for users who prefer it.

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Decision Queue                          3 items · 5 agents working         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─ Top Item (expanded) ──────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │  ⚠ Permission Approval                        waiting 12s   Low Effort│ │
│  │  ─────────────────────────────────────────────────────────────────     │ │
│  │  Fix OAuth Redirect (#42) · Session 3                                  │ │
│  │                                                                        │ │
│  │  Agent wants to run:                                                   │ │
│  │  ┌──────────────────────────────────────────────────────────────┐      │ │
│  │  │  bun run test src/server/auth.test.ts                       │      │ │
│  │  └──────────────────────────────────────────────────────────────┘      │ │
│  │                                                                        │ │
│  │  Context: Fixed OAuth redirect by moving return URL from cookie to     │ │
│  │  state parameter. Wants to verify with auth tests.                     │ │
│  │                                              ▸ Show full session       │ │
│  │                                                                        │ │
│  │  [ ✓ Approve ]  [ ✕ Deny ]  [ ✓✓ Approve All Bash ]                  │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌─ Remaining Items ──────────────────────────────────────────────────────┐ │
│  │                                                                        │ │
│  │  ✓ Task Completed        Add payment webhook (#38)          2 min ago  │ │
│  │  ◎ Code Review           Refactor user model (#45)          8 min ago  │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ── Running Agents ──────────────────────────────────────────────────────  │
│  Agent 1: writing payment tests ██████░░░░ 63%  ·  8m  ·  $0.12           │
│  Agent 2: refactoring user model ████░░░░░░ 41%  ·  3m  ·  $0.06          │
│  Agent 3: auth fix (waiting on you) ████████████ paused  ·  $0.08         │
│  Agent 4: schema migration ██░░░░░░░░ 18%  ·  1m  ·  $0.03               │
│  Agent 5: e2e test scaffold ████████░░ 79%  ·  12m  ·  $0.22              │
│                                                                             │
│  Today: cleared 12 items · 3 tasks done · $0.47 spent                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Empty state** (no items need attention):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Decision Queue                          0 items · 3 agents working         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                                                                             │
│                       3 agents working                                      │
│                Nothing needs you right now                                  │
│                                                                             │
│                [ Start a new task ]    [ View kanban board ]                │
│                                                                             │
│  ── Running Agents ──────────────────────────────────────────────────────  │
│  Agent 1: writing payment tests ██████░░░░ 63%  ·  8m  ·  $0.12           │
│  Agent 2: schema migration ██████████ done  ·  $0.34                       │
│  Agent 3: e2e test scaffold ████████░░ 79%  ·  12m  ·  $0.22              │
│                                                                             │
│  Today: cleared 12 items · 3 tasks done · $0.47 spent                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

**"While you were away" digest** (returning after idle):

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Welcome back — here's what happened while you were away (45 min)          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✅ 2 tasks completed                                                       │
│     • Add payment webhook (#38) — clean diff, all tests pass               │
│     • Schema migration (#41) — 3 files changed, no issues                  │
│                                                                             │
│  ⚠ 3 items need your attention                                             │
│     • 1 permission approval · 1 code review · 1 error triage              │
│                                                                             │
│  💰 $0.52 spent while away                                                  │
│                                                                             │
│  [ Review 3 items ]                                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Momentum Protection

The queue respects the user's current focus state.

**Rule: Never interrupt active work.** If the user is typing in a chat with Agent C and Agent A finishes, Agent A's review silently enters the queue. No toast, no sound, no badge flash. The queue count in the nav updates quietly.

**When to notify:**
- User is idle (no interaction for 2+ minutes) → gentle badge update
- User explicitly checks the queue → show everything
- Critical error (agent crashed) → subtle but persistent indicator

**Notification batching:** Instead of per-event notifications, batch into periodic digests. Configurable: every 5/10/15 minutes, or "only when I check." Default: 10 minutes.

### Batch Decisions

When multiple agents need similar approvals, batch them into a single decision:

- "Agents A, B, and C all want to run `Bash` — Approve all?" → single click
- "3 tasks completed with clean diffs — Quick review all?" → carousel view
- "5 permission requests (all `Read` tool) — Auto-approve `Read` for this session?" → one decision eliminates future interruptions

Batching reduces N decisions to 1 decision. Critical for maintaining flow.

### ADHD-Specific Patterns in the Queue

| Pattern | Implementation |
|---------|---------------|
| **Single-task focus** (Llama Life) | One expanded item at top. Everything else collapsed. |
| **What's next? button** (Goblin Tools) | The queue IS the "what's next" — it always shows the single most important item. |
| **Decision fatigue reduction** | Constrained choices per item (2-3 buttons), not open-ended. Batch similar decisions. |
| **Momentum protection** | Never interrupt active chat. Silent queue updates. |
| **State recovery** | "While you were away" digest on return. Context snippets per item. |
| **Time awareness** | "Waiting for 12 min" on each item. "Agent A has been stalled for 20 min" as gentle nudge. |
| **Dopamine design** | Satisfying animation when clearing items. Counter goes down. "Queue clear!" celebration (optional, respects reduced-motion). |
| **No-shame philosophy** | Queue items don't expire or turn red. No guilt for letting things sit. Aging boosts priority algorithmically, not visually. |

### Data Model

```typescript
// convex/schema.ts - new table
queueItems: defineTable({
  sessionId: v.id('sessions'),
  taskId: v.id('tasks'),
  type: v.union(
    v.literal('permission_approval'),
    v.literal('quick_confirmation'),
    v.literal('feedback_request'),
    v.literal('code_review'),
    v.literal('merge_decision'),
    v.literal('error_triage'),
    v.literal('task_completion'),
  ),
  status: v.union(
    v.literal('pending'),
    v.literal('in_progress'),
    v.literal('resolved'),
    v.literal('dismissed'),
  ),
  priority: v.object({
    effort: v.number(),
    blocking: v.number(),
    aging: v.number(),
    urgency: v.number(),
  }),
  contextSnippet: v.string(),
  payload: v.any(),
  createdAt: v.number(),
  resolvedAt: v.optional(v.number()),
  resolvedAction: v.optional(v.string()),
})
  .index('by_status', ['status'])
  .index('by_session', ['sessionId'])
  .index('by_task', ['taskId']),
```

### Queue Item Lifecycle

```
SDK canUseTool callback fires
  → Server creates queue item in Convex (type: permission_approval)
  → Convex real-time pushes to frontend
  → Queue re-sorts by priority score
  → If user is on queue page, top item updates
  → If user is in a different chat, queue count badge updates

User resolves item
  → Action sent back to server (approve/reject/etc.)
  → Queue item marked resolved, resolvedAction recorded
  → Agent unblocked (if permission), task state transitions (if completion)
  → Next item expands to top position
```

### Implementation Phases

**Phase 0 — Foundation** (after SDK migration + chat UI):
- Convex `queueItems` table
- Queue item creation from `canUseTool` callback (permission approvals only)
- Basic queue page: list of pending items, sorted by creation time
- Tap item → navigate to session chat
- Resolve from chat (approve/reject) → mark resolved in queue

**Phase 1 — Smart Queue:**
- Priority scoring algorithm (effort + blocking + aging)
- Expanded top item with context snippet
- Queue item creation from all event types (reviews, completions, errors)
- "While you were away" digest
- Empty state with calm messaging

**Phase 2 — Momentum & Batching:**
- Momentum protection (suppress notifications during active chat)
- Batch decisions for similar approval types
- Auto-approve rules ("always approve Read tool for this repo")
- Notification preferences (batching interval, DND mode)

**Phase 3 — Queue as Primary Interface:**
- User-configurable default landing page (queue or kanban)
- Running agents sidebar
- Daily stats footer ("Cleared 12 items today, 3 tasks completed, $0.47 spent")
- Keyboard navigation: `j`/`k` to move between items, `Enter` to act, `Esc` to dismiss

### Open Questions

- **Multi-repo filtering?** Multi-repo users might want filtering. Single-repo users might want everything in one stream.
- **Dismissed items?** Archive for later review? Gone forever? "Snoozed" with a timer?
- **Dopamine feedback?** Should completed items stay briefly with a "just cleared" animation, or disappear instantly?
- **Recommender integration?** Does the "What Should I Work On?" recommender share the queue, or is it a separate surface for suggesting *new* tasks?
- **Mobile / PWA?** If Holophyte goes PWA, the queue is the most natural mobile-first view — quick approvals from your phone while agents run on your machine.

---

## Companion Agent — Deep Dive

The Companion is a persistent, project-aware AI chat panel that fills the dead space between decisions. When the queue is empty and agents are working, you're just... waiting. That's where attention wanders. The Companion gives you something productive to do without context-switching away from Holophyte.

### What It Is (and Isn't)

The Companion is **not** another Claude Code session. It doesn't edit files or run commands. It's a lightweight conversational agent that has full awareness of your project state — running agents, queue items, task history, repo context, costs — and uses that to help you think.

| Companion | Claude Code Session |
|-----------|-------------------|
| Persistent — always available | Ephemeral — spawned per task |
| Reads project state, doesn't modify it (Phase 1) | Reads and writes code |
| Conversational / advisory | Tool-using / agentic |
| One per workspace | Many per workspace |

### Use Cases

**While waiting (queue empty):**
- "Help me plan the prompt for the auth migration task"
- "What's the architecture of the payment system?" (codebase Q&A)
- "I have 20 minutes before reviews come in — what quick tasks could I queue up?"
- "Summarize what Agent 2 has done so far on the user model refactor"

**During triage (queue active):**
- "Agent 3 failed on the E2E tests — what went wrong and how should I retry?"
- "Is this diff safe to approve? Walk me through the changes."
- "Compare the approach Agent 1 took vs what I originally asked for"

**Planning & ideation:**
- "Break down this epic into sub-tasks with dependencies"
- "What files will need to change for adding WebSocket support?"
- "Draft a prompt that would make Claude Code handle the edge cases better"

### UI: Persistent Side Panel

The Companion lives in a collapsible panel on the right edge, accessible from any view (queue, kanban board, Focus Mode). It stays open across navigation — you can be mid-conversation with the Companion while clearing queue items.

```
┌────────────────────────────────────────────────┬─────────────────────┐
│                                                │                     │
│                                                │  Companion          │
│           Queue / Board / Focus Mode           │                     │
│           (main content)                       │  "What should I     │
│                                                │   work on next?"    │
│                                                │                     │
│                                                │  Based on your      │
│                                                │  task backlog and   │
│                                                │  agent availability │
│                                                │  I'd suggest...     │
│                                                │                     │
│                                                │  ┌───────────────┐  │
│                                                │  │ Ask anything.. │  │
│                                                │  └───────────────┘  │
│                                                │                     │
└────────────────────────────────────────────────┴─────────────────────┘
```

**Panel states:**
- **Collapsed**: Small "Companion" tab on the right edge. Unobtrusive.
- **Open**: 300-350px wide panel with chat thread + input. Slides in, doesn't push main content (overlays on smaller screens).
- **Keyboard**: `Cmd+Shift+C` to toggle. `Escape` to collapse.

**Context awareness indicators:** The Companion shows what it has access to at the top of the panel — "Seeing 5 agents, 12 tasks, 3 queue items" — so the user knows it's informed without having to ask.

### Project Awareness

The Companion has read access to the full project state:

| Data Source | What It Sees |
|-------------|-------------|
| **Running agents** | Current status, task, elapsed time, cost |
| **Queue items** | Pending decisions, types, ages |
| **Tasks** | All tasks across statuses, prompts, descriptions |
| **Sessions** | History of completed sessions, costs, outcomes |
| **Repo context** | File tree, key files (README, schema, etc.) |
| **Costs** | Per-session, per-task, daily totals |

This makes the Companion useful as a **project oracle** — it can answer questions like "which tasks have failed the most?" or "what's the total cost of the auth epic?" without the user digging through dashboards.

### Phased Capabilities

**Phase 1 — Advisory (read-only):**
- Answer questions about project state, codebase, agent status
- Help draft task prompts and descriptions
- Explain agent errors and suggest retry strategies
- Summarize what happened while you were away (deeper than the digest)
- Suggest what to work on based on backlog and priorities

**Phase 2 — Actions with approval gates:**
- Create tasks (drafts them, you confirm)
- Retry failed sessions (shows the new prompt, you approve)
- Adjust agent priorities (suggests reordering, you confirm)
- Auto-approve rules ("always approve Read tool") — suggests, you enable

Each action is gated behind an inline approval: "I'd like to create a task for 'Add rate limiting to auth endpoints.' Create it?" [Create] [Edit first] [Cancel]

### Relationship to the Queue

The Companion and Decision Queue share the same screen real estate but serve different modes:

| Queue empty | Companion is the primary interaction — fills the void |
|-------------|-----------------------------------------------------|
| Queue active | Companion assists triage — "explain this error", "is this diff safe?" |
| Focus Mode | Companion available as side panel — "help me write a follow-up prompt" |

The Companion can also **proactively surface things** (gently, respecting momentum protection):
- "Agent 2 has been running for 30 minutes — that's longer than usual for this type of task. Want me to check on it?"
- "You have 3 tasks in backlog that could run in parallel right now. Want to see them?"

These are suggestions in the Companion chat, not notifications or toasts. The user sees them when they check the panel, not before.

### ADHD-Specific Design

- **No notification spam**: Proactive messages queue up silently in the Companion panel. A subtle dot indicator shows "Companion has something to say" — no sound, no toast.
- **Conversational over dashboard**: Instead of building a cost dashboard, the Companion answers "how much have I spent today?" conversationally. Less UI to build, more natural to use.
- **Rubber ducking**: ADHD brains benefit from talking through problems. The Companion is a zero-judgment sounding board that actually has context.
- **Task decomposition assist**: "I need to add user auth" → Companion helps break it into atomic, dependency-ordered sub-tasks with draft prompts. This is the hardest part of using any agent orchestrator and the Companion can scaffold it.

### Open Questions

- **Model choice?** The Companion should be fast and cheap (Haiku-class) since it's conversational, not agentic. But codebase Q&A might benefit from a stronger model. Hybrid routing?
- **Memory across sessions?** Should the Companion remember past conversations? "Last time we discussed auth, you preferred JWT over sessions" — useful but adds complexity.
- **Multiple repos?** If the user has multiple repos, does the Companion scope to the selected repo or see everything?
- **Voice input?** For ADHD users, voice-to-text for the Companion could lower the barrier to "talking through" a problem.

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

### 2. Session Cost Visibility

**Why:** Users report $70-100/night costs with competing tools. Cost transparency builds trust.

**Proposed:**
- Track cost per session in USD (from SDK usage events)
- Show running cost in session panel: "$0.47 so far"
- Per-task cumulative cost (sum of all sessions)
- Daily/weekly cost summaries in settings
- Cost is informational, not enforced — no per-task hard limits
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
