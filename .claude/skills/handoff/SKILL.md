---
name: handoff
description: Generate a paste-ready prompt to update the holophyte-thoughts wiki with what just shipped (or is about to ship) on a feature branch
allowed-tools: Bash(gh:*), Bash(git:*), AskUserQuestion
---

# Handoff to Wiki

Generate a paste-ready prompt the user runs in a separate Claude Code session inside the `holophyte-thoughts` wiki repo. The receiving agent already knows the wiki conventions from that repo's `CLAUDE.md` — your job is to give it a tight brief about *this* shipped work.

The prompt is paste-not-direct on purpose: a fresh-context wiki session avoids polluting the shipping-side context with wiki-maintenance turns.

## Usage

/handoff

## Process

### 1. Auto-pull context

All `gh` commands run with `dangerouslyDisableSandbox: true`. The block below is **pseudocode**, not a script — gather these values one at a time and substitute as you go. Issue these as **parallel Bash tool calls in a single tool block** wherever the values don't depend on each other (branch + repo + PR lookup are independent of each other).

- `BRANCH = git branch --show-current`
- `REPO = gh repo view --json nameWithOwner -q .nameWithOwner`
- Find the PR for this branch — search **both merged and open** (a handoff can be pre-merge — "what's about to ship" — or post-merge):
  - `gh pr list --repo "$REPO" --state all --head "$BRANCH" --json number,state,title,url,mergedAt,headRefOid --limit 5`
  - State labels in the output prompt should reflect reality: "merged <date>" vs "to be merged from PR #NNN".
  - If multiple PRs match the branch, or no head match exists, run **Q0** (below) to disambiguate. Never silently grab "latest merged PR in repo".
  - If the branch is pushed but no PR exists yet (`gh pr list --head` empty, both states), tell the user "open a PR first, or supply a title manually" and either bail or fall back to `BASE=$(git merge-base main HEAD)` + `git log "$BASE..HEAD" --oneline` plus a manual title via Q0's "Other".
  - If neither a PR nor a usable branch exists, same fallback: skip PR-specific fields.
- Once the PR is identified, capture `PR_NUM`, `PR_URL`, `PR_TITLE`, `MERGED_AT`, `HEAD_OID`.
- Commit list: pull from the PR directly so the range is stable even if `main` has advanced —
  - `gh pr view "$PR_NUM" --repo "$REPO" --json commits -q '.commits[] | "\(.oid[0:7]) \(.messageHeadline)"'`
  - No-PR fallback: `BASE=$(git merge-base main HEAD)`; `git log "$BASE..HEAD" --oneline`.
- Files changed: `gh pr view "$PR_NUM" --repo "$REPO" --json files -q '.files[].path'` (or `git diff --name-only "$(git merge-base main HEAD)...HEAD"`).
- PR body (for issue-reference scanning): `gh pr view "$PR_NUM" --repo "$REPO" --json body -q .body`.

**Issue references — scoped, not date-swept.** Extract `#NNN` / `Closes #NNN` / `Fixes #NNN` / `Refs #NNN` matches from commit messages **and** PR body. Resolve each via `gh issue view "$NNN" --repo "$REPO" --json number,title,state,url` (include both open and closed — closed issues filed during the branch are usually still worth linking). These become the Q3a candidates.

If the user wants a broader sweep, you may *additionally* run `gh issue list --repo "$REPO" --search "author:@me created:>=<branch-start-date>" --state all --json number,title,state,url` and label those candidates "may be unrelated — confirm" in Q3a. Never use an unscoped `gh issue list` — it leaks issues from every repo the user can access.

**Commit keyword scan** for findings: match (case-insensitive) `skip`, `xfail`, `defer`, `reject`, `revert`, `workaround`, `decision`. Do **not** match `fix` — too noisy. Real-world commits often don't follow these keywords (e.g. `wiki: session auto-update`); the scan is best-effort and Q3b's "Other" lets the user type in findings the scan missed.

### 2. Ask the user (AskUserQuestion)

Branch later questions on earlier answers.

**Q0 — Which PR / branch is this handoff about?** *(only if step 1 found 0 or >1 candidates)*
- One option per auto-detected candidate (label: `#NNN <state> — <title>`), top 3 by `mergedAt`/createdAt proximity to `HEAD`'s commit date.
- "Other" — free-text PR number or branch name.
Skip Q0 if step 1 found exactly one PR.

**Q1 — Was this work spec-driven?**
- "Yes — driven by a wiki spec/plan/task" → unlocks "What differed from the plan" (Q4).
- "No — ad-hoc; wiki just needs to learn about it" → skip Q4.

**Q2 — Authority for the receiving agent**
- "Apply edits; surface out-of-scope as findings"
- "Apply edits + filing new GH issues is OK"
- "Report only — let me apply" → output prompt instructs the agent to produce a findings markdown (proposed page paths + diffs as fenced blocks + an itemized checklist of changes), and **not** to write to disk or call `mcp__holophyte__*` mutations.

**Q3a — Referenced issues to link** (multiSelect; skip if zero candidates)
- One option per referenced issue (label: `#NNN — <title>`, including closed ones).
- Any optional date-sweep candidates, labeled "may be unrelated — confirm".
- `AskUserQuestion` caps options at 4. If you have more candidates, take the top 3 most relevant and let the user add the rest via "Other"; mention the omitted count in the question text.

**Q3b — Decisions to record from commits** (multiSelect; skip if zero candidates)
- One option per keyword-matching commit (label: `<sha7> <subject>`). Same 4-option cap as Q3a.

**Q4 — Anything that differed from the plan?** *(only if Q1 = spec-driven)*
- "Nothing notable"
- "Other" — free-text deltas

**Q5 — Audit gaps the wiki agent should triage but not fix**
- "None"
- "Other" — free-text bullets

### 3. Emit the prompt

Print the assembled prompt to the user as a fenced block they can copy. Do not invoke another agent or tool with it — the user pastes it into a separate session inside the `holophyte-thoughts` repo.

## Output template

Fill bracketed placeholders from auto-pull + answers. Drop sections that don't apply. Keep it terse — second-person, real shas/paths/issue links, no filler.

```
Update the wiki for [PR #NNN — <title>](<url>), [merged <date> | to be merged] from `<branch>`.

Source material:
- PR: <url>
- Commits: <sha7> <subject>; <sha7> <subject>; …
- Files changed: <path>; <path>; …

[IF Q1 = spec-driven AND Q4 != "Nothing notable"]
What differed from the plan:
- <Q4 free-text bullet>

[IF Q3a has selections]
Follow-up issues referenced from this branch:
- #NNN <title> — <url>
  Decide where this fits — own task, sub-task, or existing phase — and link the issue.

[IF Q3b has selections]
Considered-and-rejected / deferred decisions worth recording:
- <commit sha7> <subject> — <one-line gloss from Q3b>

[IF Q5 != "None"]
Audit gaps to triage (don't fix):
- <Q5 bullet>

Also update the corresponding holophyte kanban task(s) via the `mcp__holophyte__*` tools, scoped to the authority below. Use `mcp__holophyte__holophyte_list_tasks` and grep titles for the PR title / branch slug. For shipped work, archive the task with a one-line shipped note (the Done column is intentionally empty — completed work is archived directly). For ongoing scope that the PR only partially advanced, update the description or sub-tasks instead. If no task matches, skip the kanban update — don't create one retroactively.

Authority: <Q2 verbatim>.

Guardrails:
- Don't rewrite history of already-shipped specs; append a "shipped" note instead.
- Don't file new GitHub issues unless the authority above explicitly allows it.
```

## What the generated prompt MUST NOT contain

- Wiki-maintainer framing ("you are the wiki maintainer for…") — the receiving repo's `CLAUDE.md` already orients the agent.
- Specific spec/wiki paths — the wiki maintainer searches the index.
- Journal / `_hot.md` / `index.md` / `log.md` update instructions — the wiki's `CLAUDE.md` end-of-session rule, Dataview, and ingest/capture/lint workflows already drive these. Don't restate them.
- Restating CLAUDE.md schema (frontmatter, page types, tone, etc.).

## Style

The skill itself is a guided question flow. The *output* prompt is read cold by an agent in a different repo, so it must be self-contained: real PR numbers, real shas, real issue URLs, real file paths. No placeholders, no "TBD", no filler.

## Example

Run on branch `feat/codex-events-renderer` after merging PR #279.

### Auto-pulled context

- PR: #279 — "feat: render Codex events + isThinking signal" — https://github.com/holophyte/holophyte/pull/279, merged 2026-05-08, head `feat/codex-events-renderer`
- Commits:
  - `a1b2c3d` feat: branch sdkToUIMessages on codex.* events
  - `e4f5a6b` feat: derive isThinking from turn/started + turn/completed
  - `7c8d9e0` fix: drop tool-ordering reorder, keep in-place at item/started
  - `1f2a3b4` defer: split-state for codex idle vs running → #280
  - `5d6e7f8` chore: camelCase event normalization table
- Files changed: `src/frontend/lib/sdkToUIMessages.ts`, `src/frontend/hooks/useHolophyteChat.ts`, `wiki-pointers/codex-integration-spec.md`
- Issues referenced in commits/PR body: #280 (split-state follow-up, open)

### User answers

- **Q1** Spec-driven? → Yes (driven by Codex Integration Phase 0 spec, Task 7)
- **Q2** Authority → "Apply edits + filing new GH issues is OK"
- **Q3a** Referenced issues to link → [x] #280 — Codex split-state follow-up
- **Q3b** Decisions to record → [x] `7c8d9e0` drop tool-ordering reorder; [x] `1f2a3b4` defer split-state → #280
- **Q4** What differed from the plan? → "Real root cause was in `useSession.ts` (persisted-batch flatten dropped the `codex.<method>` wrapper), not the renderer. PR #277's hypothesis was file-wrong; Task 7's spec scope was incomplete."
- **Q5** Audit gaps → None

### Rendered output

```
Update the wiki for PR #279 — feat: render Codex events + isThinking signal (https://github.com/holophyte/holophyte/pull/279), merged 2026-05-08 from `feat/codex-events-renderer`.

Source material:
- PR: https://github.com/holophyte/holophyte/pull/279
- Commits: a1b2c3d feat: branch sdkToUIMessages on codex.* events; e4f5a6b feat: derive isThinking from turn/started + turn/completed; 7c8d9e0 fix: drop tool-ordering reorder; 1f2a3b4 defer: split-state for codex idle vs running → #280; 5d6e7f8 chore: camelCase event normalization table
- Files changed: src/frontend/lib/sdkToUIMessages.ts; src/frontend/hooks/useHolophyteChat.ts; wiki-pointers/codex-integration-spec.md

What differed from the plan:
- Real root cause was in src/frontend/hooks/useSession.ts (persisted-batch flatten dropped the codex.<method> wrapper), not the renderer. PR #277's file-scope hypothesis was wrong; Task 7's spec scope was incomplete.

Follow-up issues referenced from this branch:
- #280 Codex split-state follow-up — https://github.com/holophyte/holophyte/issues/280
  Decide where this fits — own task, sub-task, or existing phase — and link the issue.

Considered-and-rejected / deferred decisions worth recording:
- 7c8d9e0 drop tool-ordering reorder — in-place at item/started is better UX; reorder rejected.
- 1f2a3b4 defer split-state for codex idle vs running — deferred to #280; Phase 0 ships with FE-derived isThinking only.

Also update the corresponding holophyte kanban task(s) via the `mcp__holophyte__*` tools, scoped to the authority below. Use `mcp__holophyte__holophyte_list_tasks` and grep titles for the PR title / branch slug. For shipped work, archive the task with a one-line shipped note (the Done column is intentionally empty — completed work is archived directly). For ongoing scope that the PR only partially advanced, update the description or sub-tasks instead.

Authority: Apply edits + filing new GH issues is OK.

Guardrails:
- Don't rewrite history of already-shipped specs; append a "shipped" note instead.
- Don't file new GitHub issues unless the authority above explicitly allows it.
```

This example exercises every conditional section (spec-driven, Q3a issues, Q3b decisions; Q5 omitted). Use it as a shape check when tweaking the template.
