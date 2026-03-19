---
name: debugger
description: Systematic root cause investigation — reproduce, investigate, hypothesize, fix
user-invocable: true
---

# Debugger

Systematic root cause investigation. Use instead of guessing at fixes.

## Usage

/debugger <description of the bug or unexpected behavior>

## Process

### 1. Reproduce

Get a consistent reproduction before doing anything else.

- Read error messages **fully** — don't skim
- Check recent changes: `git log --oneline -10`, `git diff`
- Identify the exact steps to trigger the bug
- Confirm: can you reproduce it reliably?

If you can't reproduce, gather more information before proceeding. Ask the user for steps, logs, or screenshots.

### 2. Investigate

Trace data flow **backward** from the failure point.

- Start at the error/symptom and work toward the root cause
- Find a **working** example of similar functionality and compare — what's different?
- Check logs: server console, browser console, Convex dashboard
- Read the relevant code paths in full — don't rely on assumptions

### 3. Hypothesize

Form a **specific** hypothesis about the root cause.

- "The Convex mutation fails because the session doc is missing the `status` field after the schema migration"
- Not: "Something is wrong with the session"

Test your hypothesis with **minimal, reversible changes**:
- Add a log statement or console.log — not a fix
- Check a value at runtime — don't assume
- Verify the hypothesis is correct before writing any fix

### 4. Fix

Once the root cause is confirmed:

1. **Write a failing test** that captures the bug (when feasible)
2. **Implement the minimal fix** — don't refactor adjacent code
3. **Verify the test passes**
4. **Run the full suite**: `bun run test`, and `bun run test:e2e:isolated` if UI-related
5. **Verify the original reproduction** no longer triggers the bug

## Checkpoint

If **3+ fix attempts** each reveal new problems, **stop**. The architecture or approach may be wrong. Return to phase 1 with fresh eyes — or escalate to the user.

## Red Flags

Watch for these anti-patterns in yourself:
- **"Quick fix for now"** — if you're saying this, you haven't found the root cause
- **Proposing solutions before investigating** — understand first, fix second
- **"One more try"** after multiple failures — step back and reconsider the approach
- **Changing code you don't understand** — read it first, understand it, then change it

## Holophyte-Specific Tips

- `bun run --watch` swallows subprocess stderr — use `bun src/server.ts` directly for SDK debugging
- Check Convex dashboard for function errors (queries, mutations, actions)
- For real-time data issues, check **both** Convex dashboard logs and browser console
- For E2E failures, check if `convex:local` is running (conflicts with test ephemeral Convex)
- For auth issues, verify `ALLOW_ANONYMOUS_AUTH=1` is set and URL includes `?auth`
- SDK sessions: strip `CLAUDECODE` env var from child processes — see `manager.ts`
