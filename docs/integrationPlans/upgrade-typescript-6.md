# Prompt: Upgrade TypeScript to `6.0.3`

Upgrade Holophyte from `typescript@5.9.3` to `6.0.3`.

Context:
- TypeScript 6.0 has documented breaking changes and deprecations.
- This repo uses Bun, React 19, Convex, Vitest globals, and strict TypeScript settings.
- Current `tsconfig.json` does not set `compilerOptions.types`.
- TypeScript 6.0 changes the default `types` behavior to `[]`, so this repo likely needs explicit globals such as `bun` and `vitest/globals`.
- Current relevant settings include:
  - `module: "Preserve"`
  - `moduleResolution: "bundler"`
  - `target: "ESNext"`
  - `lib: ["ESNext", "DOM", "DOM.Iterable"]`
  - `allowJs: true`
  - `verbatimModuleSyntax: true`
  - `strict: true`
  - `noUncheckedIndexedAccess: true`

Tasks:
1. Update the TypeScript peer dependency to `^6.0.3`.
2. Run `bun install` and inspect lockfile changes.
3. Run `bunx tsc --noEmit` and fix compiler errors caused by TypeScript 6.0.
4. If globals such as `Bun`, `describe`, `it`, `expect`, or `vi` disappear, add explicit `compilerOptions.types`, likely:
   - `"bun"`
   - `"vitest/globals"`
5. Check for TypeScript 6.0 deprecations relevant to this repo:
   - `types` defaulting to `[]`
   - `rootDir` default changes
   - deprecated `baseUrl`
   - deprecated legacy module resolution settings
   - import assertion syntax changing from `asserts` to `with`
   - command-line behavior when file args are passed with a nearby `tsconfig.json`
6. Do not suppress deprecations with `ignoreDeprecations` unless there is a specific reason and it is documented.
7. Run:
   - `bun audit`
   - `bun run lint`
   - `bunx tsc --noEmit`
   - `bun run test`

Acceptance criteria:
- TypeScript 6.0.3 is installed and reflected in `package.json` / `bun.lock`.
- `bunx tsc --noEmit` passes without blanket suppression.
- Tests pass.
- Any TypeScript 6.0 config changes are narrowly scoped and explained.
