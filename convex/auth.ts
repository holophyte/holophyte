import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';

const providers = [GitHub, Google] as const;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...providers,
    ...(process.env.ALLOW_ANONYMOUS_AUTH === '1' ? [Anonymous] : []),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      await ctx.runMutation(internal.organizations.createPersonal, { userId });
    },
    async redirect({ redirectTo }) {
      // Allow localhost redirects for CLI setup (`holophyte setup`).
      // Validate the URL is well-formed and only targets localhost with a /callback path.
      if (
        redirectTo.startsWith('http://localhost:') ||
        redirectTo.startsWith('http://127.0.0.1:')
      ) {
        const url = new URL(redirectTo);
        if (
          (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
          url.pathname === '/callback'
        ) {
          return redirectTo;
        }
      }
      // Default behavior: relative paths appended to SITE_URL
      const baseUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
      if (redirectTo.startsWith('?') || redirectTo.startsWith('/')) {
        return `${baseUrl}${redirectTo}`;
      }
      if (baseUrl && redirectTo.startsWith(baseUrl)) {
        return redirectTo;
      }
      throw new Error(
        `Invalid redirectTo ${redirectTo} for SITE_URL: ${baseUrl}`,
      );
    },
  },
});
