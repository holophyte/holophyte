# Phase 3: Multi-Session UX

Make parallel sessions actually usable. Phases 1 and 2 give you a working session panel for a single session — this phase solves the "I have 5 sessions running, which ones need me?" problem.

## The Attention Problem

The whole point of Holophyte is running Claude Code sessions in parallel. But parallel interactive sessions create a multiplexing problem: your attention is a single-threaded resource, and multiple sessions compete for it. Without clear signals about which sessions need you and which are happily working, you'll either constantly poll each one (defeating the purpose of parallelism) or miss critical prompts (Claude sits waiting while you don't notice).

This phase adds three layers of attention management: tabs for switching, indicators for scanning, and notifications for interrupting.

## Session Tabs

The session panel gains a tab bar along the top. Each active session gets a tab labeled with the task name (not the session ID — the task name is what the user recognizes).

Tabs show:
- Task name (truncated if long)
- An attention badge indicating session state
- A close button (which doesn't stop the session — just closes the tab, session continues in background)

Clicking a tab switches the panel content to that session's event stream. The WebSocket subscription model matters here: you want to stay subscribed to all active sessions (so you can update badges), but only render one session's full event stream at a time.

Two approaches for WebSocket subscriptions:
1. **One WS per session**: simple, but means N connections for N sessions. Fine for 3-5 sessions, might be wasteful for 10+.
2. **Multiplexed WS**: single connection, server sends events tagged with sessionId. More complex but scales better.

For dogfooding (likely 3-5 concurrent sessions), option 1 is fine. The tab bar subscribes to all sessions but only the active tab renders the full MessageStream. Inactive tabs still process events to update their attention badge.

### Tab Ordering

Tabs should be ordered by urgency:
1. Sessions needing input (waiting_input) — leftmost, most visible
2. Running sessions (actively generating output)
3. Completed/failed sessions

Within each group, most recently active first. This way the tab that needs you is always in the same predictable spot.

Or simpler: just keep tabs in creation order (stable) and rely on the badges to draw attention. The urgency-sorted approach is nice but tabs moving around can be disorienting. Probably start with stable ordering and see how it feels.

## Attention Indicators

### On Tabs

Each tab has a small badge/dot indicating the session's state:

- **Green pulse** — actively generating output (Claude is working)
- **Amber pulse** — waiting for input (permission prompt or question)
- **Gray** — idle (session running but no recent output)
- **Checkmark** — completed successfully
- **Red dot** — failed or errored

The amber pulse is the critical one — it means "this session needs you." It should be visually insistent without being annoying. A slow pulse (1-2s cycle) with a warm color works.

### On Task Cards (Kanban Board)

The kanban board is where you spend most of your time. Task cards with active sessions should show the same attention indicators so you can scan the board and know which tasks need you without opening the session panel.

A small dot in the corner of the task card, same color scheme as the tab badges. This means the kanban board becomes a dashboard for session health — you can see at a glance: 3 tasks running (green), 1 needs input (amber), 2 completed (checkmark).

### Deriving State

Session attention state is derived from:
- `running` + recent events in last 5s → **active** (green)
- `running` + pending approval in queue → **waiting_input** (amber)
- `running` + no events in last 30s → **idle** (gray)
- `completed` → **done** (checkmark)
- `failed` / `stopped` → **error** (red)

This state lives in the Zustand store (it's UI state, not persisted). The WebSocket event handler updates it as events flow in. The approval queue state comes from the backend — when a permission event arrives, the session transitions to waiting_input; when the approval resolves, it transitions back to active.

## Notifications

For the case where you're looking at one session (or not looking at the session panel at all) and another session needs input:

### In-App Toast

A toast notification slides in from the corner: "**Task name** needs your input — Claude wants to use Edit on src/auth.ts"

Clicking the toast:
1. Opens the session panel (if collapsed)
2. Switches to that session's tab
3. Scrolls to the permission prompt
4. Focuses the panel so you can immediately interact

The toast should auto-dismiss after ~10 seconds but the permission prompt stays in the session until resolved. The toast is just the attention-grabber.

### Browser Notification API

For when the user is in a different browser tab or has the window minimized. Use the browser's `Notification` API:

```
"Holophyte — Task: Fix auth bug"
"Claude needs approval to edit src/auth.ts"
```

Clicking the browser notification brings the Holophyte tab to focus + same behavior as the in-app toast.

This requires a one-time permission grant from the user. Prompt on first session launch, store the preference.

### Notification Preferences

Not everyone wants to be interrupted the same way. A simple preference (stored in Zustand/localStorage):
- **All notifications** — toast + browser notification
- **In-app only** — toast only, no browser notifications
- **None** — badges only, no interruptions

Default to "All notifications" for dogfooding — you want to know when sessions need you.

## Zustand Store Changes

The app store needs new state for multi-session management:

```typescript
// New state
openSessions: string[]              // ordered list of open session IDs (tab order)
activeSessionId: string | null      // which tab is selected
sessionStates: Map<string, {        // attention state per session
  status: 'active' | 'waiting_input' | 'idle' | 'done' | 'error'
  lastEventAt: number
  pendingApprovals: number
}>
notificationPreference: 'all' | 'in-app' | 'none'

// New actions
openSession(sessionId: string): void    // add tab
closeSession(sessionId: string): void   // remove tab (doesn't stop session)
switchSession(sessionId: string): void  // change active tab
updateSessionState(sessionId: string, state): void
```

Persist `openSessions` and `notificationPreference` to localStorage so tabs survive page refresh. `sessionStates` is transient — rebuilt from WebSocket events on reconnect.

## Interaction Between Kanban and Sessions

When you click "Launch Claude Code" on a task, it should:
1. Start the session (Phase 1)
2. Open a new tab in the session panel (this phase)
3. Auto-switch to the new tab
4. Expand the session panel if it was collapsed

When you click on a task card that has an active session, the session panel should switch to that session's tab (if it's open) or open it.

The task detail panel should show a "View Session" button when a session is running, which does the same tab-switch behavior. And a session history section (Phase 4) for past sessions.

## Done When

- Session panel has a tab bar with one tab per active session
- Tabs show attention badges (active/waiting/idle/done/error)
- Task cards on the kanban show matching attention dots
- Toast notifications appear when a session transitions to waiting_input
- Browser notifications work (with permission prompt)
- Clicking a notification switches to the relevant session tab
- Multiple sessions can run simultaneously with independent event streams
- Tab state persists across page refresh
