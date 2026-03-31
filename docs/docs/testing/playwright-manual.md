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

1. Start the dev server: `bun run dev:local` (auto-enables `ALLOW_PASSWORD_AUTH` and `ALLOW_ANONYMOUS_AUTH`)
2. Ensure Convex has password auth: `bunx convex env set ALLOW_PASSWORD_AUTH 1` (auto-set by `worktree:create`)
3. Navigate to `http://localhost:<port>?auth` — the `?auth` query param triggers auto-login with the dev user (`dev@holophyte.test` / `password`)

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

If stopping your dev Convex is inconvenient, use the isolated variant instead:

```bash
bun run test:e2e:isolated
```

This creates a temporary detached-HEAD worktree under `~/.holophyte-dev/e2e-<timestamp>`, runs the full E2E suite there (with its own ephemeral Convex instance), and deletes the worktree on exit — even on Ctrl+C or test failure. Your main repo's `.env.local` and running dev Convex are never touched. Pass any Playwright arguments after the command:

```bash
bun run test:e2e:isolated --grep "create task"
```

### Dev auth not set up (manual testing)

Manual testing requires `ALLOW_PASSWORD_AUTH=1` in two places:

1. **Bun server process** — `bun run dev:local` sets this automatically. If running the server directly (`bun src/server.ts`), prefix with `ALLOW_PASSWORD_AUTH=1`.
2. **Convex environment** — `bunx convex env set ALLOW_PASSWORD_AUTH 1`. Auto-set by `bun run worktree:create` for new worktrees.

Without both, the `?auth` auto-login won't work. The app falls back to anonymous auth if only `ALLOW_ANONYMOUS_AUTH` is set, or shows the sign-in page. E2E tests (`bun run test:e2e`) handle both automatically via the ephemeral backend.

### Missing `?auth` query param

For manual testing (outside the E2E infrastructure), you must include `?auth` in the URL: `http://localhost:<port>?auth`. Without it, auto-login never triggers and you see the sign-in page. The E2E test suite handles this internally via `E2E_TEST=1`.

### Password auth tests use a separate Playwright project

`password-auth.spec.ts` runs in a dedicated Playwright project (`password-auth` in `playwright.config.ts`) with empty `storageState` — no pre-authenticated session. Tests use a `gotoSignIn()` helper that intercepts `/config.js` to disable `AutoTestAuth` so the sign-in page renders. If you're adding new auth tests, follow this pattern.

### Sessions completing too fast

Short prompts (`What is 2+2?`) finish in under a second — too fast to test the running state. Use prompts that require file reads, multiple tool calls, or long outputs when you need the session to stay running.

### Convex not hydrated yet

If `browser_snapshot` shows loading spinners or empty lists right after navigation, wait another 2–3 seconds and snapshot again. Convex real-time queries resolve asynchronously after mount.

## E2E on CI (GitHub Actions)

E2E tests run automatically on PRs and pushes to main via `.github/workflows/e2e.yml`. The same `bun run test:e2e` command runs on CI — no separate infrastructure, no secrets needed.

The CI runner has no Convex login session. `scripts/e2e-convex.sh` sets `CONVEX_AGENT_MODE=anonymous` — an undocumented Convex CLI env var (beta) that enables anonymous local development without login prompts — and clears `.env.local` so the CLI auto-provisions a fresh local backend.

### Key gotchas for CI

- **`CONVEX_DEPLOY_KEY` must NOT be set** — it overrides `--dev-deployment local` and silently provisions a cloud deployment instead. The script unsets it as a safeguard.
- **`CONVEX_AGENT_MODE=anonymous`** — without this, the CLI prompts for login and fails in non-interactive terminals.

## Reference

- Formal E2E tests: `e2e/*.spec.ts`
- Playwright config: `playwright.config.ts`
- Global setup/teardown: `e2e/global-setup.ts`, `e2e/global-teardown.ts`
- `waitForApp` helper: defined at the top of each spec — waits for the sidebar header before asserting
- CI workflow: `.github/workflows/e2e.yml`
- E2E Convex provisioning: `scripts/e2e-convex.sh`
- [Local Development & Worktrees](/local-development) — port allocation, Convex isolation, troubleshooting
