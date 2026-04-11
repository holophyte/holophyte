---
name: holophyte-agent-playbooks
description: Use Holophyte specialist role playbooks adapted from the previous Claude agent setup. Use when Codex needs a focused reviewer, tester, implementer, planner, researcher, documentation, Storybook, accessibility, security, backend, frontend, Convex, or DevOps workflow for this repo.
---

# Holophyte Agent Playbooks

## Codex Adaptation

Treat slash-command examples as skill names or user intents, not literal Codex command syntax. Treat `$ARGUMENTS` as the user's request text for the skill. Use Codex subagents only when the user explicitly asks for delegation, parallel agents, or team work; otherwise perform the workflow locally and use the playbooks in `holophyte-agent-playbooks` as references.

Use these references when a task calls for a specialist workflow. They point at the existing `.claude/agents` files without assuming Codex has Claude's custom-agent runtime.

## How to Use

1. Pick the closest reference for the current task.
2. Read only that `.claude/agents` reference, plus `AGENTS.md`.
3. Apply the role guidance in the current Codex session or when writing prompts for Codex subagents.
4. Ignore Claude-specific metadata fields such as `tools` and `model`; they describe the original Claude setup, not Codex capabilities.

## References

- `.claude/agents/researcher.md` - codebase research before implementation.
- `.claude/agents/planner.md` - implementation planning from research.
- `.claude/agents/critic.md` - adversarial review of plans or implementations.
- `.claude/agents/code-reviewer.md` - one-shot branch review.
- `.claude/agents/reviewer.md` - continuous review during team implementation.
- `.claude/agents/frontend-implementer.md` - React, hooks, Zustand, Tailwind, and UI work.
- `.claude/agents/backend-implementer.md` - Bun server routes, Claude Agent SDK, and companion polling.
- `.claude/agents/convex-implementer.md` - Convex schema, queries, mutations, actions, and HTTP endpoints.
- `.claude/agents/devops-implementer.md` - scripts, GitHub Actions, deployment, and worktree tooling.
- `.claude/agents/general-implementer.md` - simple or single-layer implementation tasks.
- `.claude/agents/test-writer.md` - new unit or E2E tests.
- `.claude/agents/test-fixer.md` - failing test diagnosis and repair.
- `.claude/agents/tester.md` - unit-test coverage during team implementation.
- `.claude/agents/e2e-tester.md` - Playwright E2E coverage for user-facing behavior.
- `.claude/agents/storybook-writer.md` - Storybook stories for React components.
- `.claude/agents/doc-writer.md` - Docusaurus documentation and TSDoc.
- `.claude/agents/documenter.md` - documentation work during team implementation.
- `.claude/agents/a11y-reviewer.md` - accessibility review.
- `.claude/agents/security-reviewer.md` - security review.
