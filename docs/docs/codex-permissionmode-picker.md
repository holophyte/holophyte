---
title: Codex permission-mode picker (follow-up)
draft: true
---

# Codex permission-mode picker (follow-up)

**Status:** Not started. Tracking note only.

**Discovered while shipping:** Task 8 — Codex approval renderer (PR #285, branch `feat/codex-task-8`).

## Problem

Task 8 added the FE renderer for Codex approval cards (`Run shell command?` /
`Write to file?`) and removed the companion-side `'bypass'` coercion for Codex
sessions. The renderer works, but there is no UI to set `permissionMode` on a
Codex session. `convex/sessions.create` defaults Codex sessions to `'bypass'`
to preserve pre-Task-8 UX, so approval cards never fire through the normal
launch flow.

Net effect: the renderer is dead code from a user's POV until the picker
ships. Manual testing requires either temporarily flipping the default in
`convex/sessions.ts` or calling `sessions.create` directly via
`bunx convex run` / Convex dashboard.

## What needs to ship

A single `<Select>` (or similar) in the Codex session launch surface that lets
the user choose between:

- `default` — every supported approval method prompts.
- `safe-auto` — Codex's built-in safe profile (auto-approves read-only ops).
- `bypass` — current behavior; no prompts.

Default should be `bypass` to preserve the existing one-click launch UX. Last
choice should persist per-repo or per-task to match the existing
`selectedModel` pattern.

The companion side and Convex side already accept the value end-to-end:

- `convex/sessions.create` `args.permissionMode` — already validated, plumbed
  to the row (`convex/sessions.ts:163-164`).
- `src/server/subscriptions.ts handleQueuedSession` — passes the row's
  `permissionMode` to `codex.startSession`; only falls back to `'bypass'` for
  pre-Task-8 in-flight rows (migration shim, see TSDoc on that function).
- `src/codex/manager.ts startSession` — accepts `permissionMode: PermissionMode`
  and configures the SDK accordingly.

So the work is purely frontend wiring + a state-persistence hook.

## Estimated effort

~30-60 min for the picker + ~15 min for a unit test. Low risk — pure UI
delta, no schema or contract changes.

## Suggested approach

1. Find the Codex session launch surface (model picker / launch button in
   `src/frontend/components/session/`).
2. Add a permission-mode dropdown next to the model dropdown. Reuse the same
   Radix `Select` primitive.
3. Persist last choice via Zustand (mirror `selectedModel`).
4. Thread into the existing `api.sessions.create` mutation call.
5. Unit test: render the dropdown, change it, assert mutation arg.
6. Optional E2E: launch a Codex session in `default`, verify the approval
   card appears for a write op.

## Why this isn't bundled into PR #285

PR #285 is scoped to Task 8 (renderer + companion cleanup). Bundling a new
picker drags Task 6's unfinished work into a different branch's review
surface. Cleaner as a stacked follow-up PR on top of `feat/codex-task-8`
once merged, per the project's "stacked PRs for incremental features" rule
in `CLAUDE.md`.

## Workaround until then

To exercise the renderer manually, edit `convex/sessions.ts:164` to default
Codex to `'default'`:

```ts
args.permissionMode ?? (args.provider === 'codex' ? 'default' : undefined);
```

Convex hot-reloads. Launch a Codex session, trigger a file write or shell
command. Revert before committing.
