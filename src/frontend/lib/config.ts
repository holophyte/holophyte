/** E2E test mode — set by init() from server config, skips auth gates. */
export let e2eTest = false;

/** Anonymous auth available — auto sign-in when `?auth` param is present. */
export let allowAnonymousAuth = false;

export function setE2eTest(value: boolean) {
  e2eTest = value;
}

export function setAllowAnonymousAuth(value: boolean) {
  allowAnonymousAuth = value;
}
