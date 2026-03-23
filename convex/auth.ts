import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import { Anonymous } from '@convex-dev/auth/providers/Anonymous';
import { Password } from '@convex-dev/auth/providers/Password';
import { convexAuth } from '@convex-dev/auth/server';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';

const providers = [GitHub, Google] as const;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    ...providers,
    ...(process.env.ALLOW_PASSWORD_AUTH === '1'
      ? [
          Password({
            profile: (params) => ({
              email: params.email as string,
              ...(params.name ? { name: params.name as string } : {}),
            }),
          }),
        ]
      : []),
    ...(process.env.ALLOW_ANONYMOUS_AUTH === '1' ? [Anonymous] : []),
  ],
  callbacks: {
    async createOrUpdateUser(ctx, args) {
      const {
        emailVerified: profileEmailVerified,
        phoneVerified: _profilePhoneVerified,
        ...profileData
      } = args.profile;
      const emailVerified =
        profileEmailVerified ??
        ((args.provider.type === 'oauth' || args.provider.type === 'oidc') &&
          (args.provider as { allowDangerousEmailAccountLinking?: boolean })
            .allowDangerousEmailAccountLinking !== false);
      const userData = {
        ...(emailVerified ? { emailVerificationTime: Date.now() } : {}),
        ...profileData,
      };

      // Case a: existing account re-sign-in — patch and return
      if (args.existingUserId !== null) {
        await ctx.db.patch(args.existingUserId, userData);
        return args.existingUserId;
      }

      // Case b: new sign-in — try to link by verified email.
      // Only link when the incoming provider verified the email (OAuth/OIDC).
      // This prevents a password sign-up from hijacking an existing OAuth account
      // since Password (without email verification) does not set emailVerified.
      if (emailVerified && typeof profileData.email === 'string') {
        const matches = await (ctx.db as MutationCtx['db'])
          .query('users')
          .withIndex('email', (q) => q.eq('email', profileData.email as string))
          .take(2);
        const match = matches.length === 1 ? matches[0] : undefined;
        if (match) {
          await ctx.db.patch(match._id, userData);
          return match._id;
        }
      }

      // Case c: new user — insert and create personal org
      const userId = await ctx.db.insert('users', userData);
      await ctx.runMutation(internal.organizations.createPersonal, { userId });
      return userId;
    },
    async redirect({ redirectTo }) {
      // Allow localhost redirects for CLI setup (`holophyte setup`).
      // Validate the URL is well-formed and only targets localhost with a /callback path.
      if (
        redirectTo.startsWith('http://localhost:') ||
        redirectTo.startsWith('http://127.0.0.1:')
      ) {
        try {
          const url = new URL(redirectTo);
          if (
            (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
            url.pathname === '/callback'
          ) {
            return redirectTo;
          }
        } catch {
          // Malformed localhost URL — fall through to default validation
        }
      }
      // Default behavior: relative paths appended to SITE_URL
      const baseUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');
      if (redirectTo.startsWith('?') || redirectTo.startsWith('/')) {
        return `${baseUrl}${redirectTo}`;
      }
      if (
        baseUrl &&
        (redirectTo === baseUrl ||
          redirectTo.startsWith(`${baseUrl}/`) ||
          redirectTo.startsWith(`${baseUrl}?`))
      ) {
        return redirectTo;
      }
      throw new Error(
        `Invalid redirectTo ${redirectTo} for SITE_URL: ${baseUrl}`,
      );
    },
  },
});
