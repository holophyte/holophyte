# Code review current changes

Review code changes and ensure they follow project best practices before committing or creating a PR.

**Review Process:**
1. Run `git diff main` to see all changes in current branch
2. Check that changes are focused and incremental
3. Verify adherence to holophyte coding standards

**Code Quality Checklist:**
- [ ] Named exports only — no default exports
- [ ] `import type` used for type-only imports
- [ ] Props typed with `interface ComponentNameProps`
- [ ] `cn()` used for combining classNames
- [ ] Zustand selectors use inline functions: `useAppStore((s) => s.field)`
- [ ] Convex functions use object-style with `args` + `handler`
- [ ] Bun APIs used (not Node.js equivalents)
- [ ] No `theme()` in CSS — use `var()` instead
- [ ] TypeScript strict mode compliance (`noUncheckedIndexedAccess`, etc.)

**Pre-Review Checks:**
1. Run lint: `bun run lint`
2. Run type check: `bunx tsc --noEmit`
3. Run relevant tests: `bunx vitest run path/to/relevant.test.ts`

**Review Questions:**
- Are changes focused on what was requested?
- Do changes follow existing patterns in the codebase?
- Are there any security concerns?
- Could any new code introduce regressions?

Show me the current changes or specify what you'd like me to review.
