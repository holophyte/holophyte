---
name: handoff
description: Generate a paste-ready prompt to update the holophyte-thoughts wiki with whatever just shipped on a feature branch
user-invocable: true
---

# Handoff to Wiki

Generate a paste-ready prompt the user runs in a separate Claude Code session inside the `holophyte-thoughts` wiki repo. The receiving agent already knows the wiki conventions from that repo's `CLAUDE.md` — your job is to give it a tight brief about *this* shipped work.

## Usage

/handoff

## Process

### 1. Auto-pull context

Run these in parallel (always with `dangerouslyDisableSandbox: true` for `gh`):

```bash
git branch --show-current
gh pr list --state merged --head "$(git branch --show-current)" --json number,title,headRefName,mergedAt,url --limit 1
# Fallback if on main or no branch PR:
gh pr list --state merged --json number,title,headRefName,mergedAt,url --limit 1
git log "$(gh pr view <num> --json baseRefOid -q .baseRefOid)..<headSha>" --oneline   # if PR found
# else: git log main..HEAD --oneline
```

For the PR (or branch), gather:
- PR number, title, URL, merge date, head branch
- Commit list (sha + subject)
- Files changed (`gh pr view <num> --json files -q '.files[].path'` or `git diff --name-only main...<branch>`)
- Issues filed by the user during the branch's lifetime (use the merged-PR base date or first commit date as the floor):
  ```bash
  gh issue list --search "author:@me created:>=<YYYY-MM-DD>" --state all --json number,title,state,url
  ```
- Branch name. If on `main` with no recently merged PR, ask the user which branch/PR to hand off.

Scan commit subjects for keywords: `fix`, `skip`, `xfail`, `decision`, `rejected`, `deferred`, `revert`, `workaround`. Each match becomes a candidate finding.

### 2. Ask the user (AskUserQuestion)

Branch later questions on earlier answers.

**Q1 — Was this work spec-driven?** (single-select)
- "Yes — driven by a wiki spec/plan/task" → unlocks "What differed from the plan" section.
- "No — ad-hoc; wiki just needs to learn about it" → skip that section.

**Q2 — Authority for the receiving agent** (single-select)
- "Apply edits; surface out-of-scope as findings" (default)
- "Apply edits + filing new GH issues is OK"
- "Report only — let me apply"

**Q3 — Findings to surface** (multiSelect; pre-populated)
- One option per open issue from the auto-pulled list (label: `#NNN — <title>`).
- One option per keyword-matching commit (label: `<sha7> <subject>`).
- "Other" is auto-injected for free-text additions.

**Q4 — Anything that differed from the plan?** (only if Q1 = spec-driven; free-text via "Other")

If a step has nothing to ask (e.g. no candidate findings for Q3), skip it.

### 3. Emit the prompt

Print the assembled prompt to the user as a fenced block they can copy. Do not invoke another agent or tool with it — the user pastes it into a separate session inside the `holophyte-thoughts` repo.

## Output template

Fill in the bracketed placeholders from auto-pull + answers. Drop sections that don't apply. Keep it terse — second-person, specific shas/paths/issue links, no filler.

```
Update the wiki for [PR #NNN — <title>] (<url>), merged <date> from `<branch>`.

Source material:
- PR: <url>
- Commits: <sha7> <subject>; <sha7> <subject>; …
- Files changed: <path>; <path>; …

[IF Q1 = spec-driven]
What differed from the plan:
- <Q4 free-text bullet 1>
- <Q4 free-text bullet 2>

Follow-up issues filed during this branch:
- #NNN <title> — <url>
  Decide where this fits — own task, sub-task, or existing phase — and link the issue.

Considered-and-rejected / deferred decisions worth recording:
- <commit sha7> <subject> — <one-line gloss from Q3>

Audit gaps to triage (don't fix):
- <bullet from Q3 "Other" or commit scan>

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
