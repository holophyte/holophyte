---
name: handoff
description: Generate a paste-ready prompt to update the holophyte-thoughts wiki with whatever just shipped on a feature branch
allowed-tools: Bash(gh:*), Bash(git:*), AskUserQuestion
---

# Handoff to Wiki

Generate a paste-ready prompt the user runs in a separate Claude Code session inside the `holophyte-thoughts` wiki repo. The receiving agent already knows the wiki conventions from that repo's `CLAUDE.md` — your job is to give it a tight brief about *this* shipped work.

The prompt is paste-not-direct on purpose: a fresh-context wiki session avoids polluting the shipping-side context with wiki-maintenance turns.

## Usage

/handoff

## Process

### 1. Auto-pull context

All `gh` commands run with `dangerouslyDisableSandbox: true`. The block below is **pseudocode**, not a script — gather these values one at a time and substitute as you go.

- `BRANCH = git branch --show-current`
- `REPO = gh repo view --json nameWithOwner -q .nameWithOwner`
- Find the merged PR for this branch:
  - `gh pr list --repo "$REPO" --state merged --head "$BRANCH" --json number,title,url,mergedAt,baseRefOid,headRefOid --limit 1`
  - If on `main` or the head match is empty (e.g. branch deleted post-merge), **do not** silently fall back to "latest merged PR in repo" — that can grab unrelated work. Either:
    - Pick the merged PR whose `mergedAt` is closest to `HEAD`'s commit date (`git log -1 --format=%cI`), confirm with the user before using it, or
    - Ask the user to supply the PR number / branch name explicitly.
  - If no merged PR exists at all, fall back to `git log main..HEAD --oneline` for the commit list and skip PR-specific fields.
- Once the PR is identified, capture `PR_NUM`, `PR_URL`, `PR_TITLE`, `MERGED_AT`, `HEAD_OID`.
- Commit list: pull from the PR directly so the range is stable even if `main` has advanced —
  - `gh pr view "$PR_NUM" --repo "$REPO" --json commits -q '.commits[] | "\(.oid[0:7]) \(.messageHeadline)"'`
  - No-PR fallback: `BASE=$(git merge-base main HEAD)`; `git log "$BASE..HEAD" --oneline`.
- Files changed: `gh pr view "$PR_NUM" --repo "$REPO" --json files -q '.files[].path'` (or `git diff --name-only "$(git merge-base main HEAD)...HEAD"`).
- PR body (for issue-reference scanning): `gh pr view "$PR_NUM" --repo "$REPO" --json body -q .body`.

**Issue references — scoped, not date-swept.** Extract `#NNN` / `Closes #NNN` / `Fixes #NNN` / `Refs #NNN` matches from commit messages **and** PR body. Resolve each via `gh issue view "$NNN" --repo "$REPO" --json number,title,state,url` (include both open and closed — closed issues filed during the branch are usually still worth linking). These become the Q3a candidates.

If the user wants a broader sweep, you may *additionally* run `gh issue list --repo "$REPO" --search "author:@me created:>=<branch-start-date>" --state all --json number,title,state,url` and label those candidates "may be unrelated — confirm" in Q3a. Never use an unscoped `gh issue list` — it leaks issues from every repo the user can access.

**Commit keyword scan** for findings: match (case-insensitive) `skip`, `xfail`, `defer`, `reject`, `revert`, `workaround`, `decision`. Do **not** match `fix` — too noisy.

### 2. Ask the user (AskUserQuestion)

Branch later questions on earlier answers.

**Q1 — Was this work spec-driven?**
- "Yes — driven by a wiki spec/plan/task" → unlocks "What differed from the plan" (Q4).
- "No — ad-hoc; wiki just needs to learn about it" → skip Q4.

**Q2 — Authority for the receiving agent**
- "Apply edits; surface out-of-scope as findings"
- "Apply edits + filing new GH issues is OK"
- "Report only — let me apply"

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
Update the wiki for [PR #NNN — <title>] (<url>), merged <date> from `<branch>`.

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

Also update the corresponding holophyte kanban task(s) via the `mcp__holophyte__*` tools, scoped to the authority below. Find the task by searching for the PR title or branch name; update status, description, or sub-tasks as the shipped work warrants.

Authority: <Q2 verbatim>.

Guardrails:
- Don't edit shipped task pages.
- Don't file new GitHub issues unless the authority above explicitly allows it.
```

## What the generated prompt MUST NOT contain

- Wiki-maintainer framing ("you are the wiki maintainer for…") — the receiving repo's `CLAUDE.md` already orients the agent.
- Specific spec/wiki paths — the wiki maintainer searches the index.
- Journal / `_hot.md` / `index.md` / `log.md` update instructions — Stop hooks in `holophyte-thoughts` handle those.
- Restating CLAUDE.md schema (frontmatter, page types, tone, etc.).

## Style

The skill itself is a guided question flow. The *output* prompt is read cold by an agent in a different repo, so it must be self-contained: real PR numbers, real shas, real issue URLs, real file paths. No placeholders, no "TBD", no filler.
