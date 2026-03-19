---
name: autopilot-team
description: Implement a feature using ephemeral agent teams with parallel per-task subagents, critic review, and verification
user-invocable: true
---

# Autopilot Team

Like `/autopilot`, but uses ephemeral per-task subagents for complex features that
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

Wait for the planner to finish. Review `.autopilot/plan-<branch>.md` — adjust if needed.

The plan should also group tasks by independence: which can parallelize vs which have dependencies.

**Note:** `.autopilot/` is gitignored — do not commit research or plan files unless
the feature spans multiple PRs and you need to preserve context across sessions.

### 4. Critic Review

Spawn the `critic` agent to adversarially review the plan:

> The feature being built is: `<$ARGUMENTS>`. Review the implementation plan at `.autopilot/plan-<branch>.md` for this feature. Look for wrong assumptions, missed edge cases, simpler approaches, missing failure modes, and scope creep.

If the critic finds **critical** issues (missed failure modes, wrong assumptions, simpler approaches that invalidate the plan), revise the plan before proceeding. Address **concerns** if valid. **Questions** are worth considering but don't block progress.

### 5. Execute Tasks (Ephemeral Model)

For each task group from the plan:

1. **Identify independent tasks** that can run in parallel (no shared file ownership, no data dependencies)
2. **Spawn implementers in parallel** — one ephemeral agent per task, each with a focused prompt:

   ```text
   Implement the following task from the plan at `.autopilot/plan-<branch>.md`:

   **Task:** <task description from plan>
   **Files to modify:** <file list from plan>
   **Dependencies completed:** <list of prior tasks already done>
   **Constraints:** <relevant constraints from plan>

   Follow CLAUDE.md conventions. DO NOT run `git add` or `git commit` — the orchestrator handles all git operations after parallel tasks complete to avoid index conflicts.
   Do not modify files outside your assigned scope.
   When done, report the list of files you created or modified in your completion message.

   After implementing, if your task adds user-facing behavior:
   - Write E2E tests for the new/changed flows
   - If skipping E2E, state why in your completion message

   After implementing, if your task adds new exports or components:
   - Write unit tests for new logic
   - Add TSDoc comments to new exported functions/interfaces
   ```

   Choose the right specialist for each task:
   - **`frontend-implementer`** — tasks touching `src/frontend/`
   - **`backend-implementer`** — tasks touching `src/server.ts` or `src/claude/`
   - **`convex-implementer`** — tasks touching `convex/`
   - **`devops-implementer`** — tasks touching infra, CI/CD, scripts, or config
   - **`general-implementer`** — simple tasks or single-layer changes

3. **Wait for all to complete** — each implementer reports its modified file list
4. **Commit the batch** — the orchestrator uses each implementer's reported file list to `git add <files>` and commit separately, producing one atomic commit per task. After committing all tasks, run `git status --porcelain` to check for unreported files; if any appear, commit them separately (do not amend — amending would misattribute them to the wrong task).
5. **Spawn `code-reviewer`** to review the batch's changes
6. **Fix critical issues** — spawn a fresh implementer for fixes if needed
7. **Proceed to next dependent task group**

### 6. Simplify Pass

Spawn a fresh `code-simplifier` agent to clean up all changed code:

> Review the changes on this branch (`git diff main...HEAD`) for code quality, duplication, and simplification opportunities. Fix any issues found.

This cleans up implementation before reviewers see it.

### 7. Documentation & Testing

Spawn support agents as needed (all ephemeral):

- **`test-writer`** — for new exports that need unit tests (if applicable)
- **`e2e-tester`** — for UI behavior changes (if applicable). If skipping E2E, state why.
- **`storybook-writer`** — for new reusable UI components (if applicable)
- **`doc-writer`** — for doc-worthy changes (if applicable). If skipping docs, state why.

### 8. Final Review

Spawn reviewers in parallel:

> Use the `code-reviewer` subagent to review all changes on the branch (`git diff main...HEAD`)
> Use the `security-reviewer` subagent to audit the current changes
> Use the `a11y-reviewer` subagent to audit accessibility of any new/changed UI components

Optionally spawn the `critic` agent for a second adversarial review of the implementation — useful when step 5 required significant rework or the implementation diverged from the original plan.

Fix any critical issues found.

### 9. Exploratory Verification

Verify the change works end-to-end beyond what automated tests cover. Step 10 runs lint, typecheck, unit tests, and E2E — do **not** duplicate those here. Focus on manual/exploratory checks:

- Using Playwright MCP to browse the UI and verify flows work visually
- Curling API endpoints to check responses
- Reading logs or Convex dashboard output
- Running the app and exercising the changed behavior
- Checking database state after mutations

Use your judgment about what verification is appropriate. The goal is to confirm the change actually works, not just that tests pass.

### 10. Quality Checks

```bash
bun run lint:fix
bunx tsc --noEmit
bun run test
bun run test:e2e:isolated
timeout 60000 bun run build-storybook
cd docs && bunx docusaurus build
```

Fix any remaining issues. Use the `test-fixer` subagent if tests fail.

### 11. Commit and Push

**Commit atomically** — each commit should be one logical change (e.g., schema
change, then backend handler, then frontend component). Don't batch unrelated
changes into a single commit. Task-implementation commits were created in step 5;
this step commits any remaining changes from the simplify pass (step 6),
documentation & testing (step 7), and review fixes (step 8).

```bash
git add <relevant files>
git commit -m "<conventional commit message>"
git push -u origin $(git branch --show-current)
```

### 12. Create PR

```bash
gh pr create --title "<type>: <description>" --body "<summary of changes>"
```

Use a conventional prefix in the title (`feat:`, `fix:`, `refactor:`, etc.).

### 13. PR Review Loop

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

### 14. Summary

When exiting, display:
- Tasks completed and which specialist implementer handled each
- Subagents spawned per task (implementer type, reviewer, support agents)
- Critic findings addressed (from step 4 and optional step 8)
- Review iterations with review bots
- Comments addressed vs dismissed
- Final PR URL

#### Manual Testing

Include a checklist of what the user should verify manually:
- Visual design quality (spacing, alignment, colors, responsiveness)
- UX feel (animations, transitions, loading states, focus behavior)
- Edge cases with real data (large datasets, empty states, concurrent users)
- Any flows that depend on external services (OAuth, Convex dashboard, etc.)
