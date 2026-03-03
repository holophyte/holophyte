/**
 * App configuration sourced from environment variables.
 *
 * In development (`bun run dev`), Bun.serve() substitutes process.env.* at
 * serve-time. In the static build (`bun run build`), Bun.build() inlines
 * these as string literals via the `define` option in scripts/build.ts.
 */

/** Convex deployment URL — required for the app to function. */
export const convexUrl: string = process.env.CONVEX_URL ?? '';

/** E2E test mode — skips auth gates when true. */
export const e2eTest: boolean =
  !!process.env.E2E_TEST && process.env.NODE_ENV !== 'production';

/** Anonymous auth available — auto sign-in when `?auth` param is present. */
export const allowAnonymousAuth: boolean =
  process.env.NODE_ENV !== 'production' && !!process.env.ALLOW_ANONYMOUS_AUTH;

/** Server's home directory — used to expand `~` in paths. */
export const homeDir: string = process.env.HOME ?? '';
