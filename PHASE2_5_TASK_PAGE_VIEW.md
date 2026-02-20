# Phase 2.5: Task Page View

A focused, full-canvas view for working on a single task. Rather than juggling a kanban board, a task detail panel, and a session panel as separate surfaces, the task page collapses everything into one coherent workspace.

## Why a Dedicated Page

The current three-panel layout (kanban + session panel + task detail panel) is optimized for scanning many tasks at once. Once you've decided which task you're working on, that layout is noise. You don't need to see the board — you need to see the task and the session, without the rest of the app competing for space.

The task page gives Claude the full canvas: a wide session stream that's actually comfortable to read, with the task context always visible but collapsible when you need even more space.

## Entry Points

Two ways to open a task page:

1. **Sidebar** — clicking a task in the sidebar opens its page view directly. This is the primary entry point for focused work. The sidebar already lists active tasks under each repo; the `onClick` handler changes from `selectTask()` (which shows the task detail panel) to a new `openTaskPage()` action.

2. **Kanban card** — a dedicated icon on the task card (e.g. `Maximize2` or `ArrowUpRight` from lucide) opens the page view. Single-clicking the card still selects it and shows the task detail panel as before; only the icon triggers page view. This preserves the existing board interaction model. The icon should be always visible at low opacity (not hover-only) — hover-to-reveal requires precise pointer positioning which is disproportionately difficult with joint pain.

## Layout

Side-by-side split: task details on the left, session on the right.

```
┌──────────┬──────────────────────────────────────────────────────────┐
│  Sidebar │  holophyte / Fix auth bug refresh loop  [In Progress ▾]  │
│          ├─────────────────┬────────────────────────────────────────┤
│          │  Task Info      │  Session                               │
│          │                 │                                        │
│          │  Title          │  [MessageStream  max ~72ch wide]       │
│          │  Status/labels  │                                        │
│          │  Description    │                                        │
│          │  ──────────     │  [pinned PermissionPrompt if pending]  │
│          │  (collapsible)  │  ──────────────────────────────────    │
│          │  Subtasks       │  [UserInput  — always pinned bottom]   │
│          │  Session hist.  │                                        │
└──────────┴─────────────────┴────────────────────────────────────────┘
```

The left panel is collapsible — same chevron toggle as the backlog panel. When collapsed, a narrow strip remains showing just the task title and status badge so you always know which task you're in. The right session panel expands to fill the space.

The top of the page has a slim header bar with:
- **Breadcrumb** — `project-name / Task Title`, where the project name is a clickable link back to the board for that repo
- **Status badge** — clickable to change status inline; always uses text label, not color alone (colorblind + low-vision support)
- **Elapsed timer** — shows session duration while Claude is running (e.g. `3m 42s`); helps with time blindness
- **Launch button** — same `ClaudeButton` / model picker as the task detail panel

This header is the minimum viable task identity that survives panel collapse.

## Navigation

The task page replaces the main content area (kanban board + task detail panel + session panel disappear). The sidebar stays. There is no modal or overlay — it's a proper view switch.

- **Enter**: clicking a task in the sidebar, or clicking the expand icon on a kanban card
- **Exit**: `Escape` key, clicking the project name in the breadcrumb, or clicking a repo name in the sidebar (returns to board view for that repo)
- **Switch tasks**: clicking a different task in the sidebar navigates directly to that task's page without returning to the board

## Keyboard Shortcuts

All hot-path actions must be reachable without the mouse. Repeated mouse movement is the primary source of strain for chronic pain users.

| Key | Action |
|-----|--------|
| `⌘↵` | Send message (already implemented) |
| `[` | Toggle left panel collapse |
| `Y` or `Enter` | Approve pending permission prompt |
| `N` or `Escape` | Deny pending permission prompt (when prompt is focused) |
| `Escape` | Exit task page → return to board (when no prompt is focused) |
| `⌘⇧F` | Toggle focus mode (hides sidebar + left panel) |
| `⌘K` | Command palette (already exists) |

Permission prompt keyboard shortcuts only activate when the prompt is the focused element (or when there is exactly one pending prompt and no input is focused) to avoid accidental approvals.

## Focus Mode

A `⌘⇧F` toggle for distraction-free work:
- Hides the sidebar
- Collapses the left task panel
- Removes all header chrome except the breadcrumb and status badge
- Result: essentially full-screen conversation view

Good for ADHD hyperfocus sessions and for minimizing mouse-reachable surface area during pain flares.

## Session Panel Behavior

### UserInput
- **Always pinned** to the bottom of the right panel — never shifts position as content above it changes. Moving targets require re-aiming, which is tiring with joint pain.
- **Textarea auto-grows** vertically (up to ~6 lines) rather than scrolling internally. A fixed-height scrolling textarea forces constant wrist micro-adjustments to navigate.

### MessageStream
- **Max line length ~72ch** with generous horizontal padding. Full-viewport-width text forces constant eye/head tracking on wide monitors. A comfortable column width reduces neck strain significantly.
- **Auto-scroll to bottom** while Claude streams new content. Pauses if the user scrolls up (they're reading). A `↓ Jump to latest` pill appears when not at bottom — one click or `⌘↓` to return. Eliminates anxiety about missing output while reading earlier content.
- **Chunked turn separation** — a subtle divider or extra spacing between each complete Claude turn (full response + associated tool calls). Makes the transcript scannable rather than a wall of text; easy to find where the last round of work ended.
- **No layout jank during streaming** — no elements popping in, no scroll position jumping as tokens arrive. Sudden layout movement is jarring for users with vestibular sensitivities.

### Permission Prompts
- **Pinned above UserInput**, not inline in the stream where they can scroll out of view. When a prompt is pending it must stay reachable without scrolling.
- **No time limit** — the card stays until explicitly resolved. Never auto-dismiss or fade out.
- `Y` / `Enter` to approve, `N` / `Escape` to deny (see Keyboard Shortcuts above).
- After resolution, the card moves inline into the stream as a resolved entry (approved / denied) for context, and the pinned area clears.

### Thinking Indicator
- **Elapsed time alongside the indicator** — `✦ Thinking… 0:42` updates every second. Reduces the urge to interrupt when you can see time is actually passing.

## Accessibility

### Motion
Respect `prefers-reduced-motion` throughout:
```css
@media (prefers-reduced-motion: reduce) {
  .pulse-spin { animation: none; }
  .panel-collapse { transition: none; }
  .jump-to-latest { transition: none; }
}
```
The thinking indicator falls back to a static icon. Panel collapse is instant. No decorative animations.

### Color
- Status badges always pair color with a text label — never color as the sole signal (colorblind + low-vision support)
- Permission prompts use amber accent + border + icon, not just background tint
- Code blocks in MessageStream must have ≥ 4.5:1 contrast ratio against the panel background — dark theme + dark syntax highlighting is a common failure point; verify the chosen rehype-highlight theme

### Disabled States
Don't use opacity alone. When the send button is disabled because the session has ended, pair the visual with a tooltip: `"Session completed — launch a new session to continue"`. The user needs to know *why*, not just that something is unavailable.

### Targets
All interactive elements the user hits repeatedly (collapse chevron, send button, approve/deny buttons) must be at minimum 44×44px touch/click targets, regardless of the icon size inside them.

### Screen Readers
- `MessageStream` uses an ARIA live region (`aria-live="polite"`) so streaming content is announced without interrupting the user
- Panel collapse toggle has `aria-expanded` and `aria-label="Task details"`
- Breadcrumb uses `<nav aria-label="breadcrumb">` with proper landmark structure

## Zustand Store Changes

A new view mode is needed alongside the existing `'board'` and `'seeds'` modes:

```typescript
viewMode: 'board' | 'seeds' | 'task-page'

// New action
openTaskPage(taskId: Id<'tasks'>): void  // sets viewMode + selectedTaskId
```

`openTaskPage` sets both `viewMode: 'task-page'` and `selectedTaskId`. Closing the page (Escape / breadcrumb click) calls `selectTask(null)` and resets `viewMode` to `'board'`.

Two new persisted booleans:
- `taskPageDetailCollapsed` — left panel state (like `backlogCollapsed`)
- `taskPageFocusMode` — focus mode state

## What Stays the Same

- The kanban board and its panels are unchanged — this is an additive view mode
- `SessionPanel` component is reused directly
- The session WebSocket logic, event stream, and permission prompts are identical
- The left panel content mirrors `TaskDetailPanel` — same fields, same edit-in-place behavior

## Done When

- Clicking a task in the sidebar opens the task page view
- Breadcrumb shows `project / task title`; project name links back to board
- Task page shows task info (left) + session (right) in a side-by-side split
- Left panel collapses to a title/status strip with `[` shortcut
- Right panel: UserInput pinned at bottom, MessageStream capped at ~72ch, auto-scroll with jump-to-latest pill
- Permission prompts pinned above UserInput with Y/N keyboard shortcuts
- Elapsed timer in header while session is running
- Expand icon always visible (not hover-only) on kanban cards
- `⌘⇧F` focus mode hides sidebar and left panel
- `Escape` exits task page when no prompt is focused
- `prefers-reduced-motion` respected for all animations
- Status badge always uses text label alongside color
- Disabled send button has explanatory tooltip
- All repeated interactive targets are ≥ 44×44px
- `taskPageDetailCollapsed` and `taskPageFocusMode` persist to localStorage
- Switching tasks via the sidebar navigates directly without returning to board
