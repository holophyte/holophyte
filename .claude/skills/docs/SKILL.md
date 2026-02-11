---
name: docs
description: Generate or update Docusaurus documentation
user-invocable: true
---

# Docs

Generate or update Docusaurus documentation for the Holophyte project.

## Usage

```
/docs                       → Update docs for recently changed files
/docs architecture          → Generate architecture docs
/docs components            → Generate component catalog
/docs hooks                 → Generate hook API reference
/docs convex                → Generate Convex schema reference
/docs agents                → Generate agents and skills docs
/docs --all                 → Generate all documentation
```

## Process

### 1. Ensure Docusaurus Setup

Check that `docs/` directory exists with Docusaurus config:

```bash
ls docs/docusaurus.config.ts
```

If missing, inform the user to run the setup first.

### 2. Determine Scope

Based on `$ARGUMENTS`:

- **No args**: Find recently changed files and update relevant docs:
  ```bash
  git diff main...HEAD --name-only
  ```
  Map changed files to doc topics (e.g., changed components → update `components.md`).
- **Specific topic**: Generate that topic's documentation page.
- **`--all`**: Generate all documentation pages.

### 3. Generate Documentation

Use the `doc-writer` subagent:

> Generate Docusaurus documentation for the `<scope>` topic. Read the relevant source files, write markdown to `docs/docs/`, add TSDoc comments to exported functions/interfaces that lack them, and update `docs/sidebars.ts`. See the agent instructions for conventions and format.

For `--all`, generate each topic in sequence to avoid sidebar conflicts:
1. `architecture`
2. `components`
3. `hooks`
4. `convex`
5. `agents-and-skills`

### 4. Verify Build

After documentation is generated:

```bash
cd docs && bunx docusaurus build
```

If the build fails, read the error and fix the failing page. Max 2 retries.

### 5. Report

Display:
- Pages created/updated (with file paths)
- TSDoc comments added
- DRY recommendations (repeated Convex hooks to extract)
- Build verification result (pass/fail)
