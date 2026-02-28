# Changelog

All notable changes to this project will be documented in this file.
Grouped by date, following [Keep a Changelog](https://keepachangelog.com/) categories.

## 2026-02-27

### Added
- Add timeout/cleanup for queued sessions when companion is offline (#109)
- Add isolated E2E test command via temp worktree (#107)

### Fixed
- Resolve race condition in dev:local startup serving stale CONVEX_URL (#114)
- Resolve React setState-during-render warning in OrgSwitcher (#108)
- Auto-configure INTERNAL_API_SECRET and warn on persistence failures (#106)
- Session chat exchange bugs (batchIndex + WS reconnect) (#105)

### Tests
- Add coverage for session/sessionMessages Convex mutations (#110)

### Chores
- Add setup:local script and env var reference docs (#113)

## 2026-02-26

### Added
- Restore native directory picker for adding repos (#100)

### Fixed
- dev:all fails when .env.local has a local Convex deployment (#99)

### Refactored
- Replace all frontend fetch() calls with Convex mutations (#95)

### Chores
- Enable code-simplifier plugin (#101)

## 2026-02-25

### Added
- Add assistant-ui runtime + thread swap (Phase 2) (#80)
- Add task creation from All Tasks view with repo picker (#76)

### Fixed
- Align manual testing auth query param and auto-enable ALLOW_ANONYMOUS_AUTH (#91)
- Reduce E2E and manual testing friction (#90)
- Isolate local Convex deployments across worktrees (#79)

### Refactored
- Remove old components replaced by assistant-ui (#94)
- Update pr-comments polling and add E2E tester to autopilot skills (#93)

### Chores
- Upgrade all packages to latest (#92)

## 2026-02-24

### Added
- Persistent session model with resume, dropdown UI, and kanban indicators (#52)
- Add assistant-ui adapter layer and foundation (Phase 1) (#57)

### Fixed
- Disable UserInput during running state and clean up biome suppressions (#53, #56) (#75)
- Guard against race condition on simultaneous session resume (#68) (#74)
- Log SDK error results in consumeIterator (#64) (#72)

### Refactored
- Remove unnecessary useEffects in OrgSwitcher and SeedBoard (#78)

### Chores
- Add CHANGELOG.md and update /changelog skill (#71)
- Add .playwright-mcp to .gitignore (#70)
- Remove outdated phase plan docs (#77)

### Docs
- Document Bun --watch stderr swallowing gotcha (#63) (#73)

## 2026-02-23

### Added
- Anonymous auth for E2E testing + MCP setup (#58)

### Fixed
- Handle cloud-to-local Convex deployment switch (#60)

### Chores
- Add PostToolUse lint hook for auto-formatting (#61)
- Remove project-level permission overrides (#59)

## 2026-02-22

### Added
- Migrate navigation to TanStack Router (#51)

## 2026-02-21

### Added
- 8 swappable a11y themes with oklch + CSS relative colors (#49)

## 2026-02-20

### Added
- Server-side authentication for Convex mutations (#47)
- Dedicated task page view (#46)

### Docs
- Replace phase-based planning with SESSION_RETHINK architecture (#48)

## 2026-02-19

### Added
- Replace TerminalPanel with SessionPanel conversation UI (#43)

### Fixed
- Extend port cleanup to all dev scripts
- Kill lingering processes on all dev ports before startup

### Docs
- Phase 2 findings + Phase 3 planning update (#45)

## 2026-02-17

### Fixed
- Block bare git diff and record actual model on session
- Wait for in-flight flush before final flush to prevent event loss
- Harden safe-auto patterns, session model, and resume forwarding
- Add selectedOrgId to beforeEach reset for test isolation
- Add clearOrgSelection action and tests
- Clear org selection on sign-out to prevent stale membership errors

### Tests
- Add permission mode, approval flow, and safe-auto boundary tests

## 2026-02-16

### Added
- Replace PTY session manager with Claude Agent SDK
- Improve command palette accessibility (WCAG 2.2 AA)
- Denormalize promptHistoryCount onto tasks table
- Convex Auth with OAuth and frontend auth gates (#26)

### Fixed
- Restore title tooltips on archive panel buttons
- Add missing aria-labels and semantic a11y attributes across UI
- Use type assertions instead of nullish fallbacks for validated values
- Resolve all 42 biome lint warnings
- Ensure Ctrl-C cleanly kills all dev processes
- Hide empty Actions group in command palette
- Remove non-functional actions from command palette
- Detect platform for keyboard shortcut hint (⌘K vs Ctrl+K)
- Add fallback status update on stop for closed terminal panel
- Resolve stop vs exit-event race and color failed sessions red
- Handle orphaned sessions and duplicate session guard
- Move Convex session mutations to frontend for auth context
- Poll Greptile at 5m, 7.5m, 10m instead of every 30s
- Add loading skeletons to Sidebar repos list
- Remove unnecessary task re-fetch in prompt history increment
- Remove eager prompt history from seeds.plant for consistency
- Prevent PromptHistory button flash and remove eager history recording
- Add loading skeleton to TaskDetailPanel
- Add empty state to KanbanBoard when org has no repos
- Prevent private flag hijack and cross-org label injection
- Record prompt history when planting seeds
- Enforce private task ownership in unarchive and archiveAllDone
- Bulk mutation auth + schema migration for existing data
- Address security review — path uniqueness, label ownership, repo-org check

### Refactored
- Move worktrees from sibling directory to ~/.holophyte-dev

### Chores
- Tighten schema fields to required and remove migration
- Add Docusaurus evaluation and refine Storybook criteria in autopilot skills

### Docs
- Add comprehensive README

## 2026-02-15

### Added
- RBAC enforcement and org-scoped frontend
- Org/membership data model and auth helpers (#25)

## 2026-02-11

### Added
- CLI scripts, pre-commit hooks, and local Convex workflow (#21)
- Documentation, storybook, and testing automation (#19)
- Cmd+K command palette for quick task navigation (#18)
- Prompt templates and history tracking for tasks (#12)
- Autopilot skills, subagents, and agent team support (#17)

### Chores
- Remove research doc from public repo (#22)

### Docs
- AI agent orchestration research (#20)

## 2026-02-10

### Added
- Bulk task selection and actions to Kanban board (#13)
- Edit and delete actions to tag picker
- Separate save/cancel buttons for description and prompt
- Kanban UX improvements — tags, priority, backlog animation, auto-save
- Set up Storybook with React + Tailwind v4

### Fixed
- Layout shift and flash when task sidebar opens (#15)
- Add priority config fallback and tighten getColumnTasks type
- Prevent realtime updates from clobbering unsaved description/prompt edits
- Distinct hover/selected bg colors and dashed border on collapsed backlog

### Tests
- Add unit tests for priority/status and labels CRUD, update e2e tests

### Chores
- Improve dev workflow with --watch and concurrent dev command (#16)
- Change default port from 3000 to 8080

### Style
- Add dashed border to add button

## 2026-02-09

### Added
- All kanban features: drag reorder, labels, subtasks, search, due dates, archive
- UI primitives (popover, checkbox, date-utils) and extend Zustand store
- Schema + backend for labels, subtasks, archive, time tracking, reorder
- Health, changelog, and branch-status skills
- Workflows for auto-labeling, deploy, dep review, and E2E tests
- Core CI workflow for lint, type-check, and unit tests

### Fixed
- Use origin/main for accurate merged detection from any branch
- Use iso8601 dates and --sort for branch-status stale ordering
- Restore --prune flag for accurate gone detection in branch-status
- Clarify gone detection and deps check limitations
- Use --dry-run for dependency check to keep health read-only
- Make changelog fetch step conditional for no-range fallback
- Address round 3 review comments
- Flag worktree-cleanup as destructive in branch-status notes
- Use explicit TASK_STATUSES array instead of Object.values(TaskStatus)
- Gate Convex check on file existence before grepping
- Make branch-status notes consistent with process (no --prune)
- Remove deployment value from health check example output
- Guard against missing CONVEX_URL in session manager
- Use TaskStatus enum instead of string literals in frontend comparisons
- Fix address PR review comments on new skills
- Validate date input and fetch actual subtask counts
- Use by_status index in labels.remove instead of full table scan
- Fix lint errors and install missing test dependency
- Fix 7 codebase issues identified in evaluation
- Use dynamic repo name in worktree skills
- Remove hardcoded paths from worktree-cleanup skill
- Resolve TypeScript errors in Convex tasks
- Fix lint: apply biome formatting to Input component
- Fix type errors caught by CI typecheck
- Fix deploy workflow to use 'dev' environment name
- Fix CI: pass both CONVEX_DEPLOYMENT and CONVEX_DEPLOY_KEY to codegen

### Refactored
- Apply CLAUDE.md best practices across codebase

### Chores
- Add worktree skills and document codebase conventions
- Add Claude Code commands, skills, and CLAUDE.md improvements
- Remove standalone E2E workflow — PR trigger already covered by CI

## 2026-02-08

### Added
- Frontend app, kanban board, Claude Code integration
- Phase 1: Foundation — React 19, Tailwind v4, Convex schema
- Seed box, hideable backlog, and sidebar active tasks
- Folder browser to Add Repo dialog
- Config endpoint, e2e tests, polish lint
- Unit and E2E tests for seeds, tasks, store, and UI
- Native directory picker, repo removal, better error handling

### Fixed
- Stop button not killing Claude process, add manager tests
- Claude spawn and terminal rendering errors
- Lint and type errors across codebase

### Changed
- Use Bun native PTY instead of node-pty for Claude Code sessions
- Derive repo name from git remote URL instead of folder name
- Polish sidebar: nest active tasks under projects, persist UI state
- Rewrite CLAUDE.md with project-specific guidance
- Expand CLAUDE.md with code style, TypeScript, testing, and convention docs

## 2026-02-04

### Added
- Initial commit: Electron app with React, TypeScript, and Bun
- Add packages: lucide-react, zustand, xterm.js, electron-store, msw
