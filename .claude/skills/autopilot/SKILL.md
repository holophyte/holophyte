---
name: autopilot
description: Implement a feature and iterate on Greptile review comments autonomously
user-invocable: true
---

# Autopilot

Implement a feature, push a PR, and autonomously iterate on Greptile code review
comments until resolved.

## Usage

/autopilot <description of what to implement>

## Process

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
- **New/changed UI components** → use the `a11y-reviewer` subagent to audit accessibility (already done in step 3 — review results here)
- Add TSDoc `/** */` comments to all new exported functions and interfaces

Skip Storybook/test generation if no new files were added (only modifications to existing files).

#### E2E Tests for New User-Facing Features

If the changes add or modify user-facing behavior (new UI flows, new pages, new dialogs, changed interactions), write E2E tests using the `test-writer` subagent:

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

Run E2E tests to verify:

```bash
bun run test:e2e
```

Skip E2E test generation for non-UI changes (backend-only, config, tests, docs).

#### Docusaurus Documentation Evaluation

Evaluate whether the changes warrant updating Docusaurus docs. The changes are **doc-worthy** if ANY of these are true:

- New public hook, utility, or API endpoint was added
- New component with non-trivial behavior or complex props was added
- Existing documented architecture or data flow changed meaningfully
- New Convex table, query, or mutation was added
- New agent, skill, or automation pattern was introduced

The changes are **NOT doc-worthy** if ALL of these are true:

- Bug fix or minor refactor with no API surface change
- Internal implementation detail changed (no public-facing impact)
- Style-only or config-only changes
- Test-only or story-only additions

If doc-worthy, use the `doc-writer` subagent:

> Review the changes on this branch (`git diff main...HEAD --name-only`) and update the relevant Docusaurus documentation in `docs/docs/`. Only update pages that are affected by the changes — do not regenerate unrelated docs. Add TSDoc comments to any new exported functions/interfaces that lack them. Verify with `cd docs && bunx docusaurus build`.

After generating stories, tests, and docs, verify:

```bash
bunx vitest run
bun run test:e2e
timeout 60000 bun run build-storybook
cd docs && bunx docusaurus build
```

Fix any failures before proceeding.

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

### 8. Poll for Greptile Review

Wait for all PR checks (including Greptile) to complete, then fetch new comments:

```bash
bun run pr-comments -- --poll <PR_NUMBER>
```

This uses `gh pr checks --watch` to block until all checks finish, then shows any new Greptile comments.

- If no new comments after checks complete, exit successfully — Greptile found nothing to flag

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
git commit -m "fix: address greptile review feedback"
git push
```

Return to **Step 8** for the next round.

### 12. Exit Conditions

Stop the loop when any of these are true:

- **No new comments** — Greptile found nothing new after the latest push (success)
- **Max 3 iterations** — report remaining unresolved comments to the user
- **Quality checks fail after 2 retries** — stop and report the errors

### 13. Summary

When exiting, display:
- Total iterations completed
- Comments addressed (with links) vs dismissed (with reasons)
- Any unresolved comments remaining
- Final PR URL
