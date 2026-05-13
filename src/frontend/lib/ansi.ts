/**
 * Normalized re-export of `ansi-to-react`.
 *
 * `ansi-to-react` is published as CJS. Bun's browser bundler can hand the
 * `import Ansi from 'ansi-to-react'` form out as either:
 *  - the component function directly, or
 *  - the module namespace object `{ default: fn }`, depending on HMR state.
 *
 * The second shape causes `React.createElement(Ansi, ...)` to throw
 * "Element type is invalid... got: object". This wrapper unwraps `.default`
 * defensively so callers always receive the component function.
 *
 * Lives outside `components/ai-elements/` because that directory is
 * shadcn-generated (`bunx shadcn add`); putting the workaround there would
 * be overwritten on regeneration.
 */
import AnsiImport from 'ansi-to-react';

export const Ansi = ((AnsiImport as unknown as { default?: typeof AnsiImport })
  .default ?? AnsiImport) as typeof AnsiImport;
