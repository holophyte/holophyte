/**
 * App configuration injected by the server via `<script src="/config.js">`.
 *
 * The server writes `window.__HOLOPHYTE_CONFIG__` with the Convex URL, E2E
 * flags, and anonymous auth settings. This module reads it synchronously so
 * the values are available before React renders.
 */

interface HolophyteConfig {
  convexUrl: string;
  e2eTest: boolean;
  allowAnonymousAuth: boolean;
}

const injected = (
  window as unknown as { __HOLOPHYTE_CONFIG__?: Partial<HolophyteConfig> }
).__HOLOPHYTE_CONFIG__;

/** Convex deployment URL — required for the app to function. */
export const convexUrl: string = injected?.convexUrl ?? '';

/** E2E test mode — skips auth gates when true. */
export const e2eTest: boolean = !!injected?.e2eTest;

/** Anonymous auth available — auto sign-in when `?auth` param is present. */
export const allowAnonymousAuth: boolean = !!injected?.allowAnonymousAuth;
