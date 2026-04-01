import { useAuthActions } from '@convex-dev/auth/react';
import { useConvexAuth } from 'convex/react';
import { useEffect, useRef } from 'react';
import { DEV_USER_EMAIL, DEV_USER_PASSWORD } from '@/constants';

/**
 * Auto-signs in with password credentials for E2E tests and dev `?auth` mode.
 *
 * Uses the same dev user as `seed-dev-user.sh` (dev@holophyte.test / password).
 * Only functional when `ALLOW_PASSWORD_AUTH=1` is set on the Convex backend.
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
      email: DEV_USER_EMAIL,
      password: DEV_USER_PASSWORD,
    })
      .catch(() =>
        signIn('password', {
          flow: 'signUp',
          email: DEV_USER_EMAIL,
          password: DEV_USER_PASSWORD,
          name: 'Dev User',
        }),
      )
      .catch((err: unknown) =>
        console.error('AutoTestAuth: sign-in/sign-up failed:', err),
      );
  }, [isLoading, isAuthenticated, signIn]);

  return null;
}
