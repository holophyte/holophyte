# Git commit current changes

Commit the current changes to git with a descriptive message.

**Before committing, run these checks:**
1. `bun run lint:fix` — auto-fix and verify no lint errors
2. `bunx tsc --noEmit` — type check passes

**Commit message guidelines:**
- Use present tense (e.g., "Add feature" not "Added feature")
- Keep the first line under 72 characters
- Describe what the change does, not what you did
- Use conventional commit prefixes: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`, `docs:`

**Process:**
1. Run lint and type checks (fix any issues before proceeding)
2. Review staged and unstaged changes with `git status` and `git diff`
3. Stage relevant files (prefer specific files over `git add .`)
4. Commit with a descriptive message

If checks fail, fix the issues and re-run before committing.
