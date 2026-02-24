---
sidebar_position: 2
title: Playwright MCP Manual Testing
---

# Playwright MCP Manual Testing

Playwright MCP is a Model Context Protocol server that lets Claude Code drive a real Chrome browser. Use it for exploratory UI testing during development — when you want to verify interactions without writing formal E2E tests.

## When to Use It

| Use case | Tool |
|----------|------|
| Quickly verify a UI change looks right | Playwright MCP |
| Check that a session start/stop flow works end-to-end | Playwright MCP |
| Reproduce a bug reported by a user | Playwright MCP |
| Regression testing across multiple browsers on CI | Formal E2E tests in `e2e/` |
| Assertions that must pass on every merge | Formal E2E tests in `e2e/` |

For automated regression testing, see the formal E2E suite in `e2e/app.spec.ts`.

## Setup

The Playwright MCP server is configured in the project. Claude Code can use it directly — no manual install needed. The MCP server controls a Chrome instance; if Chrome is not installed, Playwright will download a managed Chromium binary.

**Start the dev server before testing:**

```bash
bun run dev:local   # or bun run dev:all for cloud Convex
```

## Testing Flow

The core pattern for every manual test:

1. **Navigate** — go to the URL
2. **Wait** — pause 2–3 seconds for Convex to hydrate (real-time queries need a moment to load)
3. **Snapshot** — call `browser_snapshot` to read the accessibility tree
4. **Interact** — click, type, submit
5. **Verify** — snapshot again, check console messages

```
navigate → wait 2–3s → snapshot → interact → verify
```

### Key Patterns

**Use `browser_snapshot` over screenshots for assertions.** The accessibility tree tells you what is actually rendered and interactive. Screenshots show pixels; snapshots show structure.

**Check the console after interactions.** `browser_console_messages` surfaces React errors, failed Convex queries, and WebSocket errors that are invisible in the accessibility tree.

**Always wait after navigation.** Convex queries fire after the component mounts. Snapshots taken immediately after navigation may show loading states rather than real data.

## Session Testing

### Stop Button

To test the stop button you need a session that stays running long enough to click it.

1. Open a task page
2. Submit a prompt that generates a long response — for example: `Read every file in the src directory one by one and summarize each`
3. Wait 3–5 seconds for Claude to start working (green dot on the kanban card)
4. Snapshot — verify the stop button is visible
5. Click the stop button
6. Snapshot — the session status should transition to idle (gray dot)

If Claude finishes before you can click stop, use an even longer prompt or one that requires multiple tool calls.

### Permission Prompts

To trigger a tool-use permission prompt, explicitly request a tool in your prompt:

> Use the Bash tool to run: `echo hello world`

This forces Claude to request permission before executing. The permission prompt appears inline in the session panel.

1. Submit the prompt above
2. Wait for the permission UI to appear (snapshot to confirm)
3. Approve or deny
4. Verify Claude continues (approve) or acknowledges the denial (deny)

### Resume After Idle

1. Start a simple session and let it complete: `What is 2 + 2?`
2. Wait for the session to go idle (gray dot, no spinning indicator)
3. Send a follow-up: `Now multiply that by 10`
4. Verify the **same session** goes back to running — the session dropdown should still show one entry, not two
5. Verify the WebSocket reconnects (no errors in `browser_console_messages`)

### Sending Messages

The session input accepts `Meta+Enter` (Cmd+Enter on Mac) to submit. Plain Enter adds a newline. When driving with Playwright MCP, use the keyboard shortcut after typing into the input.

## Common Gotchas

### Chrome singleton lock conflicts

If a previous Playwright session crashed, Chrome may have left a lock file. Symptoms: the browser fails to open or hangs. Fix:

```bash
pkill -f "chrome.*remote-debugging"
```

Then retry. Playwright MCP will start a fresh instance.

### Sessions completing too fast

Short prompts (`What is 2+2?`) finish in under a second — too fast to test the running state. Use prompts that require file reads, multiple tool calls, or long outputs when you need the session to stay running.

### Route catch-all was blocking POST requests

The SPA catch-all route in `src/server.ts` is GET-only. POST requests to `/api/*` go to the correct handlers. This was a past bug (now fixed) — if you see 405 errors on session start, check that the catch-all has an explicit method guard.

### Convex not hydrated yet

If `browser_snapshot` shows loading spinners or empty lists right after navigation, wait another 2–3 seconds and snapshot again. Convex real-time queries resolve asynchronously after mount.

## Reference

- Formal E2E tests: `e2e/app.spec.ts`
- Playwright config: `playwright.config.ts`
- `waitForApp` helper: defined at the top of `e2e/app.spec.ts` — waits for the sidebar header before asserting
