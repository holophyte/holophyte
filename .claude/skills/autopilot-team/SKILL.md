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

```bash
REPO=$(basename "$(git rev-parse --show-toplevel)")
```

```bash
git worktree add ../$REPO-<feature-name> -b feat/<feature-name>
cp .env ../$REPO-<feature-name>/ 2>/dev/null || true
cp .env.local ../$REPO-<feature-name>/ 2>/dev/null || true
cd ../$REPO-<feature-name> && bun install
```

Derive a short feature name from `$ARGUMENTS`.

### 2. Plan the Work

Before spawning teammates, break `$ARGUMENTS` into discrete tasks:

- Identify which files/modules need changes
- Split work so each teammate owns different files (avoid conflicts)
- Aim for 3-6 tasks total across teammates
- Create tasks using the task list so teammates can self-claim

### 3. Spawn the Team

Spawn three teammates with specific roles:

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
> You are the test writer for the Holophyte project. Watch for completed
> implementation tasks. Write unit tests for new functionality using Vitest
> (globals enabled, no imports needed for describe/it/expect). Co-locate tests
> with source files (e.g., `foo.ts` → `foo.test.ts`). Run tests with
> `bunx vitest run <file>`. If tests fail, message the implementer with details
> so they can fix the implementation. Do not modify implementation code yourself.

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

Follow the same Greptile polling and iteration loop as `/autopilot`:

1. Poll for Greptile comments (30s intervals, 5min timeout)
2. Triage comments as actionable vs dismissable
3. Fix actionable ones, reply to dismissable ones
4. Push and repeat (max 3 iterations)

### 9. Summary

When exiting, display:
- Teammates spawned and their roles
- Tasks completed by each teammate
- Review iterations with Greptile
- Comments addressed vs dismissed
- Final PR URL
