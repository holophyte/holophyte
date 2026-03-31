import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';
import { useEffect, useRef } from 'react';

/** Known test credentials — used by E2E global-setup and dev `?auth` mode. */
const TEST_EMAIL = 'e2e@holophyte.test';
const TEST_PASSWORD = 'holophyte-e2e-2024';

/**
 * Auto-signs in with password credentials for E2E tests and dev `?auth` mode.
 *
 * Unlike anonymous auth, re-authenticating with the same email always returns
 * the same user (same org, same repos), avoiding the stale-token problem where
 * anonymous recovery creates a new user without org membership.
 *
 * On first run (fresh database), sign-in fails and falls back to sign-up.
 */
export default function AutoTestAuth() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (isLoading || isAuthenticated || attempted.current) return;
    attempted.current = true;

    void signIn('password', {
      flow: 'signIn',
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    }).catch(() =>
      signIn('password', {
        flow: 'signUp',
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      }),
    );
  }, [isLoading, isAuthenticated, signIn]);

  return null;
}
