# Session Rethink — Manual Testing Guide

## Prerequisites

1. Start the dev server: `bun run dev:all` (or `bun run dev:local` from the worktree)
2. Ensure `INTERNAL_API_SECRET` is set in both `.env.local` and Convex env (`bunx convex env list` to verify)
3. Run the migration if you haven't: `bunx convex run migrations:backfillSessions`

---

## 1. New Session Lifecycle

> **Prompt:** `What is 2 + 2?`

1. Open a task with no sessions
2. Type the prompt and submit — a session should be created
3. Watch the **kanban card** — dot should be **green (pulsing)** while Claude is working
4. When the turn finishes, the dot should turn **gray** (idle)
5. The session dropdown should show one entry with status "Idle"

## 2. Resume (Follow-up Message)

> **Prompt:** `Now multiply that by 10`

1. With the session from step 1 now idle, type the prompt and send
2. The **same session** should go back to "Running" (green dot) — no new entry in the dropdown
3. When the turn finishes, it should go back to "Idle" (gray dot)
4. Check the session dropdown — still only **one** session, not two

## 3. Session Dropdown

> **Prompt for new session:** `List the files in the current directory`

1. Click the session dropdown trigger (shows session name + status dot)
2. Verify the popover lists sessions sorted by most recent activity
3. Click "New session" at the bottom
4. The input should clear and show the prompt input for a fresh session
5. Submit the prompt — this creates a **second** session
6. Open the dropdown again — both sessions should be listed
7. Click the first session to switch back — conversation history should load

## 4. Server Restart Recovery

1. Have at least one session in any state
2. Stop the dev server (Ctrl+C) and restart it
3. Navigate to the task — sessions should show as **Idle**, not "Failed"
4. You should be able to type a follow-up to resume them
5. Check server logs — should see "Marked N stale running session(s) as idle on startup."

## 5. Direct URL Navigation (SPA Routing)

1. Copy a task page URL, e.g. `http://localhost:8080/repos/<id>/tasks/<id>/page`
2. Open it in a **new tab** (or hard refresh with Cmd+Shift+R)
3. The page should render correctly — no 404, no MIME errors, no blank page
4. Verify `http://localhost:8080/` still works too

This works because `'/*': { GET: homepage }` is registered as a catch-all inside `routes` (not `fetch`), so Bun serves the compiled HTML bundle (with correct `/_bun/...` asset paths) rather than the raw source file for all unmatched GET requests.

## 6. Failed Session

> **Prompt:** `Read the file /nonexistent/path/that/does/not/exist.txt`

1. Start a session on a task pointing to an invalid repo path (or temporarily break the repo path in Convex)
2. The session should show status "Failed" with a red dot
3. The input should be disabled with message "Session failed — launch a new session to continue"
4. Click "New session" in the dropdown — you should be able to start a fresh one

## 7. Permission Prompts

> **Prompt:** `Create a file called test-permissions.txt with the text "hello world"`

1. Start a session with the prompt above
2. A permission prompt should appear in the session panel (Write or Bash tool)
3. Approve or deny it — Claude should continue or acknowledge the denial
4. The session should go idle after the turn completes

## 8. Stop Mid-Session

> **Prompt:** `Read every file in the src directory one by one and summarize each`

1. Start a session with the prompt above (gives Claude enough work to stay busy)
2. Click the stop button while Claude is working
3. The session should go to **Idle** (not Failed) — it's resumable
   - The stop button sets `stoppedByUser = true` before aborting; `consumeIterator` uses this flag to choose `idle` over `failed` in the cleanup path
4. Send a follow-up to verify resume works after stopping: `Continue where you left off`

---

## Playwright MCP Approach

For automated regression testing of the session flow, you can use the Playwright MCP server to drive Chromium directly from a Claude session. This is useful for quick smoke tests without writing full `*.spec.ts` files.

Start a Holophyte session with the Playwright MCP configured, then ask Claude to:

```
Navigate to http://localhost:8080, create a task, submit a prompt, wait for the
session to go idle, then send a follow-up and verify it goes running then idle again.
```

The Playwright MCP provides `browser_navigate`, `browser_click`, `browser_type`, `browser_wait_for`, and `browser_snapshot` tools that Claude can chain together to exercise the full session lifecycle interactively.

For long-running test suites, use `bun run test:e2e` with the Playwright spec files in `e2e/`.
