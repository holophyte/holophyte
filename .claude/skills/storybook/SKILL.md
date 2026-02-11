---
name: storybook
description: Generate Storybook stories for components
user-invocable: true
---

# Storybook

Generate Storybook stories for React components in the Holophyte project.

## Usage

```
/storybook                  → Stories for components changed on current branch
/storybook TaskCard         → Story for a specific component
/storybook --all            → Stories for all unstorified components
```

## Process

### 1. Determine Targets

Based on `$ARGUMENTS`:

- **No args**: Find components changed on current branch:
  ```bash
  git diff main...HEAD --name-only --diff-filter=AM | grep '\.tsx$' | grep -v '\.stories\.' | grep -v '\.test\.'
  ```
- **`--all`**: Find all `.tsx` components without a corresponding `.stories.tsx`:
  ```bash
  # List all component files, exclude those that already have stories
  ```
  Use Glob to find `src/frontend/components/**/*.tsx` and filter out files that have a sibling `.stories.tsx`.
- **Specific component name**: Find the component file by name using Glob.

### 2. Generate Stories

For each target component, use the `storybook-writer` subagent:

> Generate a Storybook story for `<component-path>`. Follow the project's story conventions — see the agent instructions for the exact pattern. If the component should be skipped (Convex-connected wrapper, WebSocket-dependent, etc.), explain why and skip it.

Run subagents in parallel for multiple components (max 4 concurrent).

### 3. Verify Build

After all stories are generated:

```bash
timeout 60000 bun run build-storybook
```

If the build fails, read the error and fix the failing story. Max 2 retries.

### 4. Report

Display:
- Stories created (with file paths)
- Components skipped (with reasons)
- Build verification result (pass/fail)
