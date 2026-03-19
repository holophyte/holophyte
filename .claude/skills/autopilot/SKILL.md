---
name: autopilot
description: Implement a feature and iterate on PR review comments autonomously
user-invocable: true
---

# Autopilot

Implement a feature, push a PR, and autonomously iterate on PR code review
comments until resolved.

## Usage

/autopilot <description of what to implement>

## Process

### 0. Evaluate Complexity (Optional Brainstorm Gate)

Before starting, assess whether the feature needs design discussion:

**Use `/brainstorm` first if:**
- New data model or schema changes with multiple valid approaches
- New system boundary (new API endpoint, new WebSocket message type, new external integration)
- The feature description is ambiguous or underspecified
- Multiple architectural approaches exist with meaningful trade-offs

**Skip and proceed to step 1 if:**
- The approach is obvious from existing patterns
- The user has given specific, detailed instructions
- It's a bug fix, refactor, or enhancement to existing behavior

### 1. Set Up Worktree (if needed)

If not already on a feature branch, create a worktree to avoid disrupting current work:

```bash
BRANCH=$(git branch --show-current)
```

- If on `main`: derive a short feature name from `$ARGUMENTS` (e.g., "add drag reordering" becomes `drag-reordering`), then run `bun run worktree:create <feature-name>` and work from the new worktree directory
- If already on a `feat/` branch: continue in the current directory

### 2. Research the Codebase

Before writing any code, spawn the `researcher` agent to explore the codebase.
Pass the feature description from `$ARGUMENTS` as context.

### 3. Plan the Implementation

Based on the research, write an implementation plan to `.autopilot/plan-<branch>.md` (same branch suffix as the research file):

- List the files to create or modify (in order)
- For each file, describe the approach and include **code snippet examples** showing how it should look — reference existing patterns from the research (e.g., "follow the same pattern as `SessionDropdown.tsx` lines 20-35")
- Be **descriptive** — explain the _why_ and show the _shape_ of the code, not a line-by-line prescription. The implementer (you) should understand the intent and adapt.
- Use prescriptive step-by-step instructions only for mechanical/boilerplate changes (schema migrations, config edits, etc.)
- Identify risks or edge cases
- If the plan has multiple valid approaches, pick the simplest one (KISS)

Do NOT use EnterPlanMode — write the plan file, then proceed.

**Note:** `.autopilot/` is gitignored — do not commit research or plan files unless
the feature spans multiple PRs and you need to preserve context across sessions.

### 3.5. Critic Review

Spawn the `critic` agent to adversarially review the plan before implementation:

> Review the implementation plan at `.autopilot/plan-<branch>.md` for this feature. Look for wrong assumptions, missed edge cases, simpler approaches, missing failure modes, and scope creep.

If the critic finds **critical** issues (missed failure modes, wrong assumptions, simpler approaches that invalidate the plan), revise the plan before proceeding. Address **concerns** if they're valid. **Questions** are worth considering but don't block progress.

### 4. Implement the Feature

Implement the feature described in `$ARGUMENTS`, following `.autopilot/plan-<branch>.md`.

**Commit atomically** — each commit should be one logical change (e.g., schema
change, then backend handler, then frontend component). Don't batch unrelated
changes into a single commit.

- Follow all patterns and conventions in CLAUDE.md
- Run quality checks when implementation is complete:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
```

- If tests fail, use the `test-fixer` subagent to analyze and fix failures
- Fix lint/type errors directly

### 4.5. Simplify Pass

Spawn a fresh `code-simplifier` agent to review changed code for reuse, quality, and efficiency:

> Review the changes on this branch (`git diff main...HEAD`) for code quality, duplication, and simplification opportunities. Fix any issues found.

This cleans up the implementation before reviewers see it — so they're reviewing the best version, not flagging issues that simplify would have caught.

### 5. Self-Review with Subagents

Before committing, run reviewers in parallel:

> Use the code-reviewer subagent to review the current changes
> Use the security-reviewer subagent to audit the current changes
> Use the a11y-reviewer subagent to audit accessibility of any new/changed UI components

- Fix any **critical** issues from any reviewer (including critical a11y issues)
- Evaluate **warnings** and fix if valid
- **Suggestions** are optional — skip unless clearly beneficial
- Run quality checks again if changes were made

### 5.5. Documentation, Testing, and Accessibility for New Code

Check for new and changed files on the branch:

```bash
git diff main...HEAD --name-only --diff-filter=A   # new files
git diff main...HEAD --name-only                     # all changed files
```

For each new file:
- **New reusable UI components or components with multiple visual states** → use the `storybook-writer` subagent to generate a co-located `.stories.tsx`. Skip Storybook for page-level layouts, data-coupled feature components that need extensive Convex mocking, and thin wrappers with no visual complexity.
- **New `.ts`/`.tsx` exports** → use the `test-writer` subagent to generate co-located tests
- **New/changed UI components** → use the `a11y-reviewer` subagent to audit accessibility (already done in step 5 — review results here)
- Add TSDoc `/** */` comments to all new exported functions and interfaces

Skip Storybook/test generation if no new files were added (only modifications to existing files).

#### E2E Tests

Write E2E tests for this change. If skipping, state the reason.

Valid skip reasons: backend-only change, config-only change, test-only change, no new user-facing behavior.

If writing E2E tests, use the `test-writer` subagent:

> Write Playwright E2E tests for the new/changed user-facing features on this branch.
> Tests go in `e2e/` directory with pattern `*.spec.ts`.
> Follow the existing E2E patterns in `e2e/app.spec.ts` and `e2e/all-tasks-create.spec.ts`:
> - Import `{ expect, test }` from `@playwright/test`
> - Use `waitForApp(page)` helper: `page.goto('/')` + `page.waitForSelector('text=Holophyte', { timeout: 30000 })`
> - Global setup creates an e2e repo (name matches `/e2e-/`) and saves auth state — tests reuse this via `storageState`
> - Use generous timeouts for visibility checks (5-10s) — Convex queries are async
> - Scope dialog assertions to `[role="dialog"]` to avoid strict mode collisions
> - Use `{ exact: true }` for ambiguous text matches
> - Each test run gets a fresh Convex database — no cleanup needed, but use unique names (e.g. `Date.now()`) to avoid collisions within a run
> - Do NOT start Convex or the dev server — `bun run test:e2e` handles the full lifecycle
> Review existing specs in `e2e/` for reference patterns.

#### Docusaurus Documentation

Evaluate docs and state your decision. If skipping, explain why.

The changes are **doc-worthy** if ANY of these are true:

- New public hook, utility, or API endpoint was added
- New component with non-trivial behavior or complex props was added
- Existing documented architecture or data flow changed meaningfully
- New Convex table, query, or mutation was added
- New agent, skill, or automation pattern was introduced

If doc-worthy, use the `doc-writer` subagent:

> Review the changes on this branch (`git diff main...HEAD --name-only`) and update the relevant Docusaurus documentation in `docs/docs/`. Only update pages that are affected by the changes — do not regenerate unrelated docs. Add TSDoc comments to any new exported functions/interfaces that lack them. Verify with `cd docs && bunx docusaurus build`.

#### Pre-Commit Verification Checklist

Before proceeding to commit, verify:
- [ ] E2E tests: written, or reason for skipping stated
- [ ] Documentation: updated, or reason for skipping stated
- [ ] All quality checks pass (lint, typecheck, tests, E2E)

Use `bun run test:e2e:isolated` to run E2E tests without stopping the dev Convex backend — this runs in a temp worktree and avoids port conflicts.

After generating stories, tests, and docs, verify:

```bash
bunx vitest run
bun run test:e2e:isolated
timeout 60000 bun run build-storybook
cd docs && bunx docusaurus build
```

Fix any failures before proceeding.

### 5.75. Agent-Driven Verification

Verify the change works end-to-end before creating the PR. Use whatever tools and approaches make sense for the change — examples include but aren't limited to:
- Running tests (`bun run test`, `bun run test:e2e:isolated`)
- Using Playwright MCP to browse the UI and verify flows work visually
- Curling API endpoints to check responses
- Reading logs or Convex dashboard output
- Running the app and exercising the changed behavior
- Checking database state after mutations

Use your judgment about what verification is appropriate. The goal is to confirm the change actually works, not just that tests pass.

### 6. Commit and Push

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push -u origin $(git branch --show-current)
```

### 7. Create or Update PR

Check if a PR already exists for this branch:

```bash
gh pr list --head $(git branch --show-current) --json number --jq '.[0].number'
```

- If no PR exists, create one with `gh pr create` — use a conventional prefix in the title (e.g., `feat: add drag reordering to kanban columns`)
- If PR exists, it's already updated by the push

### 8. Poll for PR Review

Wait for all PR checks to complete, then fetch new comments:

```bash
bun run pr-comments -- --poll <PR_NUMBER>
```

This uses `gh pr checks --watch` to block until all checks finish, then shows any new review bot comments.

- If no new comments after checks complete, exit successfully — review bots found nothing to flag

### 9. Triage Comments

Read the output from the polling script. Categorize each new comment:

**Actionable** — fix the code:
- Bug or correctness issues
- Security concerns
- Clear code quality improvements

**Dismissable** — reply explaining why no change is needed:
- Stylistic preferences that conflict with project conventions in CLAUDE.md
- False positives or misunderstandings of intent
- Suggestions that would over-engineer the solution

### 10. Address Comments

For each actionable comment:
1. Read the file at the referenced line
2. Fix the issue
3. Reply to the comment with a brief explanation of the fix

For each dismissable comment:
1. Reply to the comment explaining why no change is needed

Reply to comments using:

```bash
gh api repos/{owner}/{repo}/pulls/<PR>/comments/<COMMENT_ID>/replies \
  -f body="<reply>"
```

### 11. Push and Loop

After addressing all comments:

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
```

- If tests fail, use the `test-fixer` subagent to fix them

```bash
git add <changed files>
git commit -m "fix: address review feedback"
git push
```

Return to **Step 8** for the next round.

### 12. Exit Conditions

Stop the loop when any of these are true:

- **No new comments** — review bots found nothing new after the latest push (success)
- **Max 3 iterations** — report remaining unresolved comments to the user
- **Quality checks fail after 2 retries** — stop and report the errors

### 13. Summary

When exiting, display:
- Total iterations completed
- Comments addressed (with links) vs dismissed (with reasons)
- Any unresolved comments remaining
- Final PR URL

#### Manual Testing

Include a checklist of what the user should verify manually:
- Visual design quality (spacing, alignment, colors, responsiveness)
- UX feel (animations, transitions, loading states, focus behavior)
- Edge cases with real data (large datasets, empty states, concurrent users)
- Any flows that depend on external services (OAuth, Convex dashboard, etc.)
