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

Spawn the `researcher` agent to explore the codebase before planning. Pass the
feature description from `$ARGUMENTS` as context.

Wait for the researcher to finish before proceeding to step 3.

### 3. Plan the Work

Spawn the `planner` agent to design the implementation based on research findings.
Pass the feature description from `$ARGUMENTS` as context.

Wait for the planner to finish. Review `.autopilot/plan-<branch>.md` and the tasks — adjust if needed before spawning the team.

**Note:** `.autopilot/` is gitignored — do not commit research or plan files unless
the feature spans multiple PRs and you need to preserve context across sessions.

### 4. Spawn the Team

Based on the planner's recommendation in `.autopilot/plan-<branch>.md`, choose which
implementers and support agents to spawn. **Not every role is needed every time** —
spawn only what the feature requires.

Each sub-agent should determine the current branch with `git branch --show-current`
to resolve the `<branch>` placeholder in file paths.

#### Implementer Specialists (pick based on plan)

- **`frontend-implementer`** — spawn when tasks touch `src/frontend/`
- **`backend-implementer`** — spawn when tasks touch `src/server.ts` or `src/claude/`
- **`convex-implementer`** — spawn when tasks touch `convex/`
- **`devops-implementer`** — spawn when tasks touch infra, CI/CD, scripts, or config
- **`general-implementer`** — spawn for simple features or when one agent can handle it all

#### Support Agents (always spawn reviewer; others as needed)

- **`reviewer`** (always spawn) — continuous code review, messages implementers with categorized issues
- **`tester`** (spawn when new logic is added) — writes Vitest unit tests, messages implementers on failure
- **`e2e-tester`** (spawn when UI behavior changes) — writes Playwright E2E tests, messages implementers on failure
- **`documenter`** (spawn when new public APIs or components are added) — Storybook, TSDoc, Docusaurus, DRY extraction

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

### 9. PR Review Loop

Wait for all PR checks (including review bots) to complete, then iterate on comments:

1. **Wait for checks and fetch new comments:**
   ```bash
   bun run pr-comments -- --poll <PR_NUMBER>
   ```
   This uses `gh pr checks --watch` to block until all checks finish, then shows any new review bot comments.
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
- Review iterations with review bots
- Comments addressed vs dismissed
- Final PR URL
