# Phase 2.5: Task Page View

A focused, full-canvas view for working on a single task. Rather than juggling a kanban board, a task detail panel, and a session panel as separate surfaces, the task page collapses everything into one coherent workspace.

## Why a Dedicated Page

The current three-panel layout (kanban + session panel + task detail panel) is optimized for scanning many tasks at once. Once you've decided which task you're working on, that layout is noise. You don't need to see the board — you need to see the task and the session, without the rest of the app competing for space.

The task page gives Claude the full canvas: a wide session stream that's actually comfortable to read, with the task context always visible but collapsible when you need even more space.

## Entry Points

Two ways to open a task page:

1. **Sidebar** — clicking a task in the sidebar opens its page view directly. This is the primary entry point for focused work. The sidebar already lists active tasks under each repo; the `onClick` handler changes from `selectTask()` (which shows the task detail panel) to a new `openTaskPage()` action.

2. **Kanban card** — a dedicated icon on the task card (e.g. `Maximize2` or `ArrowUpRight` from lucide) opens the page view. Single-clicking the card still selects it and shows the task detail panel as before; only the icon triggers page view. This preserves the existing board interaction model.

## Layout

Side-by-side split: task details on the left, session on the right.

```
┌──────────┬────────────────────────────────────────────┐
│  Sidebar │  Task Page                                  │
│          ├─────────────────┬──────────────────────────┤
│          │  Task Info      │  Session                  │
│          │                 │                           │
│          │  Title          │  [MessageStream]          │
│          │  Status/labels  │                           │
│          │  Description    │                           │
│          │  ──────────     │                           │
│          │  (collapsible)  │  [UserInput]              │
│          │  Subtasks       │                           │
│          │  Session hist.  │                           │
└──────────┴─────────────────┴──────────────────────────┘
```

The left panel is collapsible — same chevron toggle as the backlog panel. When collapsed, a narrow strip remains showing just the task title and status badge so you always know which task you're in. The right session panel expands to fill the space.

The top of the page has a slim header bar with:
- **Back arrow** → returns to the kanban board
- **Task title** (always visible, even when the left panel is collapsed)
- **Status badge** — clickable to change status inline
- **Launch button** — same `ClaudeButton` / model picker as the task detail panel

This header is the minimum viable task identity that survives panel collapse.

## Navigation

The task page replaces the main content area (kanban board + task detail panel + session panel disappear). The sidebar stays. There is no modal or overlay — it's a proper view switch.

- **Enter**: clicking a task in the sidebar, or clicking the expand icon on a kanban card
- **Exit**: back arrow in the header, `Escape` key, or clicking a repo name in the sidebar (returns to board view for that repo)
- **Switch tasks**: clicking a different task in the sidebar navigates directly to that task's page without returning to the board

## Zustand Store Changes

A new view mode is needed alongside the existing `'board'` and `'seeds'` modes:

```typescript
viewMode: 'board' | 'seeds' | 'task-page'

// New action
openTaskPage(taskId: Id<'tasks'>): void  // sets viewMode + selectedTaskId
```

`openTaskPage` sets both `viewMode: 'task-page'` and `selectedTaskId`. Closing the page (back arrow / Escape) calls `selectTask(null)` and resets `viewMode` to `'board'`.

The `taskPageDetailCollapsed` boolean (like `backlogCollapsed`) controls the left panel, persisted to localStorage.

## Session Behavior

When the task page opens:
- If the task has a running session, the session panel connects automatically (same `useSession` hook as `SessionPanel`)
- If no active session, the right panel shows the launch UI (same `ClaudeButton` + model picker)
- If the task has past sessions but no active one, the right panel shows the most recent session's event replay with a "Launch new session" button above it (session history from Phase 4 — for Phase 2.5, just show the launch UI)

The session panel inside the task page is the same `SessionPanel` component, just rendered without its own header since the page header takes that role.

## Sidebar Change

The sidebar currently calls `selectTask(task._id)` on task click, which opens the task detail panel on the board. This changes to `openTaskPage(task._id)` — clicking a task in the sidebar always opens the page view.

The task items in the sidebar already show an active indicator (pulsing `Sprout` for in-progress with running session, `Eye` for review). These stay as-is.

## What Stays the Same

- The kanban board and its panels are unchanged — this is an additive view mode
- `SessionPanel` component is reused directly
- The session WebSocket logic, event stream, UserInput, and permission prompts are identical
- The left panel content mirrors `TaskDetailPanel` — same fields, same edit-in-place behavior

## Done When

- Clicking a task in the sidebar opens the task page view
- Task page shows task info (left) + session (right) in a side-by-side split
- Left panel collapses to a title/status strip, right session panel expands to fill
- Page header always shows task title, status, and back navigation
- Expand icon on kanban cards opens the task page
- Escape / back arrow / repo click returns to board view
- `taskPageDetailCollapsed` persists to localStorage
- Switching tasks via the sidebar navigates directly without returning to board
