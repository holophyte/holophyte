---
name: autopilot-team
description: Implement a feature using an agent team with parallel implementer, reviewer, and tester
user-invocable: true
---

# Autopilot Team

Like `/autopilot`, but spawns a coordinated agent team for complex features that
benefit from parallel work and independent perspectives.

Use this for larger features that touch multiple files or modules. For smaller,
focused changes, prefer `/autopilot` (single-agent).

## Usage

/autopilot-team <description of what to implement>

## Process

### 1. Set Up Worktree

Create a worktree for the team to work in (always — teams should never work on main):

Derive a short feature name from `$ARGUMENTS`, then:

```bash
bun run worktree:create <feature-name>
```

Work from the new worktree directory after creation.

### 2. Plan the Work

Before spawning teammates, break `$ARGUMENTS` into discrete tasks:

- Identify which files/modules need changes
- Split work so each teammate owns different files (avoid conflicts)
- Aim for 3-6 tasks total across teammates
- Create tasks using the task list so teammates can self-claim

### 3. Spawn the Team

Spawn teammates with specific roles:

**Implementer** (use Sonnet):
> You are the implementer for the Holophyte project. Your job is to write feature
> code following the patterns in CLAUDE.md. Claim implementation tasks from the
> task list. When done with a task, mark it complete and claim the next one.
> Coordinate with the reviewer — if they flag issues, fix them before moving on.
> Do not write tests — the tester handles that.

**Reviewer** (use Sonnet):
> You are the code reviewer for the Holophyte project. Monitor the implementer's
> work by watching for completed tasks. Review each changed file for correctness,
> conventions, and security. Message the implementer directly with any issues —
> organized as critical (must fix), warnings (should fix), and suggestions (optional).
> Only flag real problems, not style nitpicks already covered by Biome.

**Tester** (use Sonnet):
> You are the unit test writer for the Holophyte project. Watch for completed
> implementation tasks. Write unit tests for new functionality using Vitest
> (globals enabled, no imports needed for describe/it/expect). Co-locate tests
> with source files (e.g., `foo.ts` → `foo.test.ts`). Run tests with
> `bunx vitest run <file>`. If tests fail, message the implementer with details
> so they can fix the implementation. Do not modify implementation code yourself.

**E2E Tester** (use Sonnet):
> You are the E2E test writer for the Holophyte project. Watch for completed
> implementation tasks that add or change user-facing behavior. Write Playwright
> E2E tests in the `e2e/` directory with pattern `*.spec.ts`.
>
> Follow the existing patterns in `e2e/app.spec.ts` and `e2e/all-tasks-create.spec.ts`:
> - Import `{ expect, test }` from `@playwright/test`
> - Use `waitForApp(page)` helper: `page.goto('/')` + `page.waitForSelector('text=Holophyte', { timeout: 30000 })`
> - Global setup creates an e2e repo (name matches `/e2e-/`) and saves auth state — tests reuse this via `storageState`
> - Use generous timeouts for visibility checks (5-10s) — Convex queries are async
> - Scope dialog assertions to `[role="dialog"]` to avoid strict mode collisions
> - Use `{ exact: true }` for ambiguous text matches
> - Each test run gets a fresh Convex database — no cleanup needed, but use unique names (e.g. `Date.now()`) to avoid collisions within a run
>
> Run tests with `bun run test:e2e`. This spins up an ephemeral Convex backend
> automatically — do NOT start Convex or the dev server yourself.
> If tests fail, message the implementer with details so they can fix the
> implementation. Do not modify implementation code yourself.
> Skip E2E tests for non-UI changes (backend-only, config, tests, docs).

**Documenter** (use Sonnet):
> You are the documentation specialist for the Holophyte project. Watch for
> completed implementation tasks. Your responsibilities:
>
> **Storybook**: For new reusable UI components or components with multiple visual
> states, generate a co-located `.stories.tsx`. Skip Storybook for page-level
> layouts, data-coupled feature components that need extensive Convex mocking, and
> thin wrappers with no visual complexity. Verify with `timeout 60000 bun run
> build-storybook`.
>
> **TSDoc**: Add TSDoc comments to all new exported functions and interfaces.
>
> **Docusaurus**: Evaluate whether changes warrant updating project docs in
> `docs/docs/`. Changes are doc-worthy if they add new public hooks, utilities,
> API endpoints, components with non-trivial behavior, Convex tables/queries, or
> agents/skills. Changes are NOT doc-worthy if they are bug fixes, internal
> refactors, style-only, config-only, or test-only changes. If doc-worthy, update
> only the affected Docusaurus pages — do not regenerate unrelated docs. Verify
> with `cd docs && bunx docusaurus build`.
>
> **DRY**: If you notice repeated Convex query patterns across components, extract
> them into custom hooks in `src/frontend/hooks/`.
>
> Do not modify implementation logic. Coordinate with the tester to avoid file
> conflicts.

### 4. Coordinate

As team lead:

- Monitor teammate progress via the task list
- Redirect teammates if they go off-track
- Resolve conflicts if teammates disagree
- When all tasks are complete, ask the reviewer for a final review
- When the reviewer approves, proceed to step 5

### 5. Quality Checks

After all teammates finish:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
bun run test:e2e
timeout 60000 bun run build-storybook
cd docs && bunx docusaurus build
```

Fix any remaining issues. Use the `test-fixer` subagent if tests fail.

### 6. Commit and Push

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push -u origin $(git branch --show-current)
```

### 7. Create PR

```bash
gh pr create --title "<type>: <description>" --body "<summary of changes>"
```

Use a conventional prefix in the title (`feat:`, `fix:`, `refactor:`, etc.).

### 8. Greptile Review Loop

Wait for all PR checks (including Greptile) to complete, then iterate on comments:

1. **Wait for checks and fetch new comments:**
   ```bash
   bun run pr-comments -- --poll <PR_NUMBER>
   ```
   This uses `gh pr checks --watch` to block until all checks finish, then shows any new Greptile comments.
2. **Triage new comments** as:
   - **Actionable** (bugs, security, clear quality issues) — fix the code, reply with explanation
   - **Dismissable** (style conflicts, false positives, over-engineering) — reply explaining why
3. **Reply** to comments:
   ```bash
   gh api repos/{owner}/{repo}/pulls/<PR>/comments/<COMMENT_ID>/replies \
     -f body="<reply>"
   ```
4. **Push** — run quality checks, commit fixes, push
5. **Repeat** from step 1 (max 3 iterations)
6. **Exit** when no new comments appear or max iterations reached

### 9. Summary

When exiting, display:
- Teammates spawned and their roles
- Tasks completed by each teammate
- E2E tests written by E2E Tester
- Stories and docs created by Documenter
- Review iterations with Greptile
- Comments addressed vs dismissed
- Final PR URL
