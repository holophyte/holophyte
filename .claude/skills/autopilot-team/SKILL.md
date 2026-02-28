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

### 2. Research

Spawn a researcher to explore the codebase before planning:

**Researcher** (use Sonnet):
> You are the researcher for the Holophyte project. Your job is to explore the
> codebase and gather context before implementation begins. For the feature
> described in the task list, find:
>
> - Existing patterns and conventions relevant to this change
> - Files that will need to be modified or serve as reference implementations
> - Related components, hooks, utilities, or Convex functions
> - Schema/data model implications
> - Any prior art or similar features already built
> - Potential pitfalls, edge cases, or gotchas
>
> Read CLAUDE.md first for project conventions. Write your findings to
> `.autopilot/research.md` with sections: **Overview**, **Relevant Files** (with
> paths and line ranges), **Patterns to Follow** (with code snippets from the
> existing codebase), **Risks & Gotchas**, and **Dependencies**.
> Do NOT write any code — research only.

Wait for the researcher to finish before proceeding to step 3.

### 3. Plan the Work

Spawn a planner to design the implementation based on research findings:

**Planner** (use Sonnet):
> You are the implementation planner for the Holophyte project. Read the
> researcher's findings from `.autopilot/research.md`, then write an
> implementation plan to `.autopilot/plan.md`.
>
> The plan should include:
>
> **Tasks** (aim for 3-6):
> - Break the feature into discrete, parallelizable tasks
> - Assign each task to specific files/modules to avoid merge conflicts
> - Identify task dependencies — what must be done first vs. what can parallelize
>
> **Implementation guidance** for each task:
> - Describe the approach and include **code snippet examples** showing the shape
>   of the code — reference existing patterns (e.g., "follow `SessionDropdown.tsx`
>   lines 20-35 for the dropdown pattern")
> - Be **descriptive** — explain the _why_ and show the _shape_, not a
>   line-by-line prescription. Implementers should understand intent and adapt.
> - Use prescriptive step-by-step only for mechanical changes (schema migrations,
>   config edits, wiring up imports)
>
> **Team composition recommendation**:
> - Based on which layers the feature touches, recommend which specialist
>   implementers to spawn. Options: `frontend`, `backend`, `convex`, `devops`,
>   or `general` (for features contained to one layer or simple enough for one
>   agent). Explain your reasoning.
>
> Create tasks in the task list with clear descriptions and file ownership.
> Do NOT write any code — planning only.

Wait for the planner to finish. Review `.autopilot/plan.md` and the tasks — adjust if needed before spawning the team.

**Note:** `.autopilot/` is gitignored — do not commit research or plan files unless
the feature spans multiple PRs and you need to preserve context across sessions.

### 4. Spawn the Team

Based on the planner's recommendation in `.autopilot/plan.md`, choose which
implementers and support agents to spawn. **Not every role is needed every time** —
spawn only what the feature requires.

#### Implementer Specialists (pick based on plan)

**Frontend Implementer** — spawn when tasks touch `src/frontend/`:
> You are the frontend implementer for the Holophyte project. Read the plan at
> `.autopilot/plan.md` and claim frontend tasks from the task list. Your domain:
> React components, hooks, Zustand stores, Tailwind styles, and assistant-ui
> integration. Follow patterns in CLAUDE.md — use `cn()` for classNames, Radix UI
> for primitives, `useQuery`/`useMutation` for Convex data, inline Zustand
> selectors. Do not write tests — the tester handles that. Coordinate with the
> reviewer.

**Backend Implementer** — spawn when tasks touch `src/server.ts` or `src/claude/`:
> You are the backend implementer for the Holophyte project. Read the plan at
> `.autopilot/plan.md` and claim backend tasks from the task list. Your domain:
> Bun.serve() routes, WebSocket handlers, Claude Agent SDK session management
> (`src/claude/manager.ts`), and companion polling logic. Follow patterns in
> CLAUDE.md — use `Bun.serve()` for HTTP, structured JSON responses, `console.error`
> for errors. Do not write tests — the tester handles that. Coordinate with the
> reviewer.

**Convex Implementer** — spawn when tasks touch `convex/`:
> You are the Convex implementer for the Holophyte project. Read the plan at
> `.autopilot/plan.md` and claim Convex tasks from the task list. Your domain:
> schema changes, queries, mutations, actions, and HTTP endpoints in `convex/`.
> Follow patterns in CLAUDE.md — use `v` validators for all args, object-style
> function definitions, descriptive index names, `Date.now()` for timestamps.
> Do not write tests — the tester handles that. Coordinate with the reviewer.

**DevOps Implementer** — spawn when tasks touch infra, CI/CD, scripts, or config:
> You are the devops implementer for the Holophyte project. Read the plan at
> `.autopilot/plan.md` and claim infrastructure tasks from the task list. Your
> domain: shell scripts in `scripts/`, GitHub Actions workflows, deployment config,
> `package.json` scripts, `.dev-ports`, worktree tooling, and Convex deployment.
> Follow patterns in CLAUDE.md — use Bun for everything, respect `.dev-ports` for
> port configuration, ensure scripts work in both main repo and worktrees. Do not
> write tests — the tester handles that. Coordinate with the reviewer.

**General Implementer** — spawn for simple features or when one agent can handle it all:
> You are the implementer for the Holophyte project. Read the plan at
> `.autopilot/plan.md` and claim implementation tasks from the task list. When done
> with a task, mark it complete and claim the next one. Follow patterns in CLAUDE.md.
> Coordinate with the reviewer — if they flag issues, fix them before moving on.
> Do not write tests — the tester handles that.

#### Support Agents (always spawn reviewer; others as needed)

**Reviewer** (always spawn):
> You are the code reviewer for the Holophyte project. Read `.autopilot/plan.md`
> for context. Monitor implementers' work by watching for completed tasks. Review
> each changed file for correctness, conventions, and security. Message the
> implementer directly with any issues — organized as critical (must fix), warnings
> (should fix), and suggestions (optional). Only flag real problems, not style
> nitpicks already covered by Biome.

**Tester** (spawn when new logic is added):
> You are the unit test writer for the Holophyte project. Watch for completed
> implementation tasks. Write unit tests for new functionality using Vitest
> (globals enabled, no imports needed for describe/it/expect). Co-locate tests
> with source files (e.g., `foo.ts` → `foo.test.ts`). Run tests with
> `bunx vitest run <file>`. If tests fail, message the implementer with details
> so they can fix the implementation. Do not modify implementation code yourself.

**E2E Tester** (spawn when UI behavior changes):
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

**Documenter** (spawn when new public APIs or components are added):
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

### 5. Coordinate

As team lead:

- Monitor teammate progress via the task list
- Redirect teammates if they go off-track
- Resolve conflicts if teammates disagree
- When all tasks are complete, ask the reviewer for a final review
- When the reviewer approves, proceed to step 6

### 6. Quality Checks

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

### 7. Commit and Push

**Commit atomically** — each commit should be one logical change (e.g., schema
change, then backend handler, then frontend component). Don't batch unrelated
changes into a single commit. Implementers should commit their own work as they
complete each task, not save everything for one big commit at the end.

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push -u origin $(git branch --show-current)
```

### 8. Create PR

```bash
gh pr create --title "<type>: <description>" --body "<summary of changes>"
```

Use a conventional prefix in the title (`feat:`, `fix:`, `refactor:`, etc.).

### 9. Greptile Review Loop

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

### 10. Summary

When exiting, display:
- Teammates spawned and their roles (including which specialist implementers were chosen and why)
- Tasks completed by each teammate
- E2E tests written by E2E Tester
- Stories and docs created by Documenter
- Review iterations with Greptile
- Comments addressed vs dismissed
- Final PR URL
