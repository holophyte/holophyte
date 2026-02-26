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

**Prerequisites:**

1. Start local Convex: `bun run convex:local`
2. Set anonymous auth (once per Convex instance): `bunx convex env set ALLOW_ANONYMOUS_AUTH 1`
3. Start the dev server: `bun run dev:local`
4. Navigate to `http://localhost:<port>?auth` — the `?auth` query param triggers anonymous auth

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

### Orphaned Chromium processes

If a test run crashes or is killed, Chromium processes may linger. Symptoms: subsequent runs fail to launch a browser, or memory usage spikes.

```bash
pkill -f "chromium.*--headless"
```

### Stop `convex:local` before running E2E tests

`bun run test:e2e` spins up its own ephemeral Convex backend automatically. The Convex CLI refuses to provision when another local backend is active, so stop `convex:local` first (Ctrl+C in that terminal).

### Anonymous auth not set up (manual testing)

Manual testing requires `ALLOW_ANONYMOUS_AUTH=1` on the Convex environment. Without it, auth never completes and the app appears stuck. Run once per Convex instance:

```bash
bunx convex env set ALLOW_ANONYMOUS_AUTH 1
```

> **Note:** `bun run worktree:create` sets this automatically for new worktrees. E2E tests (`bun run test:e2e`) handle this automatically via the ephemeral backend.

### Missing `?auth` query param

For manual testing (outside the E2E infrastructure), you must include `?auth` in the URL: `http://localhost:<port>?auth`. Without it, anonymous auth never triggers and you get a blank/stuck state with no error message. The E2E test suite handles this internally via `E2E_TEST=1`.

### Sessions completing too fast

Short prompts (`What is 2+2?`) finish in under a second — too fast to test the running state. Use prompts that require file reads, multiple tool calls, or long outputs when you need the session to stay running.

### Convex not hydrated yet

If `browser_snapshot` shows loading spinners or empty lists right after navigation, wait another 2–3 seconds and snapshot again. Convex real-time queries resolve asynchronously after mount.

## Reference

- Formal E2E tests: `e2e/*.spec.ts`
- Playwright config: `playwright.config.ts`
- Global setup/teardown: `e2e/global-setup.ts`, `e2e/global-teardown.ts`
- `waitForApp` helper: defined at the top of each spec — waits for the sidebar header before asserting
- [Local Development & Worktrees](/local-development) — port allocation, Convex isolation, troubleshooting
