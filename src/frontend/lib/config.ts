/** E2E test mode — set by init() from server config, skips auth gates. */
export let e2eTest = false;

export function setE2eTest(value: boolean) {
  e2eTest = value;
}
